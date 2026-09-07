import { RateLimiter, buildRateLimitPolicies } from '../application/rate-limit';
import { Logout, RefreshSession, SessionIssuer } from '../application/session';
import { AuthenticateUser, ListProducts } from '../application/use-cases';
import { LockoutPolicy } from '../domain/value-objects';
import type {
  Clock,
  ErrorReporter,
  IdGenerator,
  Logger,
  MetricsRecorder,
  PasswordHasher,
  TokenSigner,
  UserRepository,
} from '../domain/ports';
import type { RateLimitPolicies } from '../application/rate-limit';
import {
  Argon2PasswordHasher,
  INERT_PASSWORD_HASH,
  JoseTokenSigner,
  Sha256TokenGenerator,
} from '../infrastructure/security';
import { CursorCodec } from '../infrastructure/persistence/cursor-codec';
import {
  DynamoDbProductRepository,
  DynamoDbRateLimiterStore,
  DynamoDbReadinessProbe,
  DynamoDbRefreshTokenRepository,
  DynamoDbUserRepository,
  createClients,
} from '../infrastructure/persistence/dynamodb';
import { InMemoryProductRepository } from '../infrastructure/persistence/in-memory/in-memory-product-repository';
import { InMemoryRateLimiterStore } from '../infrastructure/persistence/in-memory/in-memory-rate-limiter-store';
import { InMemoryRefreshTokenRepository } from '../infrastructure/persistence/in-memory/in-memory-refresh-token-repository';
import { InMemoryUserRepository } from '../infrastructure/persistence/in-memory/in-memory-user-repository';
import {
  EmfMetricsRecorder,
  NoopErrorReporter,
  NoopMetricsRecorder,
  SentryErrorReporter,
} from '../infrastructure/observability';
import { AlwaysReadyProbe, type ReadinessProbe } from '../infrastructure/system/readiness-probe';
import type { ProductRepository, RateLimiterStore, RefreshTokenRepository } from '../domain/ports';
import { SystemClock } from '../infrastructure/system/system-clock';
import { UuidV7IdGenerator } from '../infrastructure/system/uuid-v7-id-generator';
import type { Product, User } from '../domain/entities';
import type { AppConfig } from '../infrastructure/config/env';

/**
 * Composition root.
 *
 * É o único lugar do projeto autorizado a conhecer todas as camadas ao mesmo
 * tempo: aqui os adaptadores concretos são instanciados e injetados nos casos
 * de uso, que enxergam apenas as portas do domínio.
 *
 * Não há container de injeção de dependência por escolha deliberada. Uma
 * biblioteca como `tsyringe` ou `inversify` esconderia o grafo de dependências
 * atrás de decorators e somaria trabalho de reflexão ao cold start do Lambda,
 * em troca de conveniência que um projeto deste tamanho não precisa. Uma função
 * que devolve um objeto é rastreável com "ir para definição" e trivial de
 * substituir por fakes nos testes.
 *
 * O container cresce junto com as issues seguintes:
 *
 * | Issue | O que passa a ser montado aqui                                   |
 * | ----- | ---------------------------------------------------------------- |
 * | #7    | Cliente DynamoDB no lugar dos repositórios em memória             |
 * | #9    | `Logger` de verdade (pino) e o cliente do Sentry                  |
 */
export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  /**
   * Acesso direto aos adaptadores de escrita, usado apenas pela carga inicial.
   *
   * Não é atalho para os casos de uso: é o reconhecimento de que popular dados
   * não é intenção de negócio e não deveria inventar um caso de uso só para
   * existir.
   */
  readonly seeding: Seeding;
  readonly policies: Policies;
  readonly useCases: UseCases;
  readonly services: Services;
}

export interface UseCases {
  readonly authenticateUser: AuthenticateUser;
  readonly refreshSession: RefreshSession;
  readonly logout: Logout;
  readonly listProducts: ListProducts;
}

/**
 * Serviços que a borda HTTP usa antes de chegar a um caso de uso (issue #8).
 *
 * O limitador não é caso de uso: ele não realiza intenção de negócio nenhuma,
 * apenas decide se a requisição segue adiante.
 */
export interface Seeding {
  readonly users: SeedableUserRepository;
  readonly products: SeedableProductRepository;
  readonly passwordHasher: PasswordHasher;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

/**
 * Repositório de catálogo que aceita escrita.
 *
 * A porta do domínio só declara leitura, porque nenhum caso de uso cria
 * produto. Popular dados não é intenção de negócio e não deveria inventar um
 * caso de uso só para existir, então a capacidade fica aqui, restrita a quem
 * carrega os dados.
 */
/**
 * Repositório de usuários que a carga inicial consegue consultar por
 * identificador.
 *
 * A porta do domínio busca por e-mail, que é o que a autenticação precisa.
 * Carregar dados precisa de outra pergunta — "este registro já existe?" — e ela
 * fica restrita a quem carrega, em vez de alargar o contrato do domínio.
 */
export interface SeedableUserRepository extends UserRepository {
  findById(id: string): Promise<User | null>;
}

export interface SeedableProductRepository extends ProductRepository {
  add(product: Product): void | Promise<void>;
}

export interface Services {
  readonly rateLimiter: RateLimiter;
  readonly readiness: ReadinessProbe;
  /**
   * Exposto porque a verificação do token acontece na borda HTTP, antes de
   * qualquer caso de uso: quem chega sem credencial válida não deve consumir
   * nem a decisão de negócio.
   */
  readonly tokenSigner: TokenSigner;
  /** Encaminha falha imprevista para quem opera. */
  readonly errorReporter: ErrorReporter;
  /** Publica contagem e duração, base de painel e alarme. */
  readonly metrics: MetricsRecorder;
}

/**
 * Regras parametrizáveis do domínio.
 *
 * São objetos de domínio, mas a calibragem vem do ambiente. Montá-los aqui
 * mantém a regra em um lugar só e permite ajustar o comportamento por
 * implantação sem recompilar: um ambiente de homologação pode tolerar mais
 * tentativas de login que produção.
 */
export interface Policies {
  readonly lockout: LockoutPolicy;
  readonly rateLimit: RateLimitPolicies;
}

/**
 * Monta o grafo de dependências da aplicação a partir da configuração validada.
 *
 * Recebe a configuração pronta em vez de ler `process.env` por dentro: assim os
 * testes montam o container com qualquer cenário sem tocar no ambiente do
 * processo, e o entrypoint continua sendo o único responsável por carregar o
 * ambiente de verdade.
 *
 * @throws {ValidationError} se a configuração passar pelo schema mas violar uma
 *   invariante do domínio — por exemplo, um teto de bloqueio menor que a duração
 *   base. O schema garante que cada valor é um inteiro positivo; a coerência
 *   entre eles é regra de domínio, e falha aqui, na subida.
 */
export function buildContainer(config: AppConfig, logger: Logger): Container {
  const lockout = LockoutPolicy.create({
    maxAttempts: config.lockout.maxAttempts,
    baseDelayMs: config.lockout.baseDelayMs,
    maxDelayMs: config.lockout.maxDelayMs,
  });

  const clock = new SystemClock();
  const observability = buildObservability(config, logger, clock);
  const passwordHasher = new Argon2PasswordHasher();
  const tokenSigner = new JoseTokenSigner({
    secret: config.auth.jwtSecret,
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    clock,
  });

  // A persistência real chega na issue #7. Até lá o repositório em memória
  // respeita o mesmo contrato, incluindo a concorrência otimista, então trocar
  // a implementação não altera nenhum caso de uso.
  const secureTokens = new Sha256TokenGenerator();
  const idGenerator = new UuidV7IdGenerator();
  const cursors = new CursorCodec(config.auth.jwtSecret);

  const { users, refreshTokens, products, rateLimiterStore, readiness } = buildPersistence(
    config,
    cursors,
    logger,
  );

  const sessionIssuer = new SessionIssuer({
    tokenSigner,
    secureTokens,
    idGenerator,
    clock,
    accessTokenTtlSeconds: config.auth.accessTtlSeconds,
    refreshTokenTtlSeconds: config.auth.refreshTtlSeconds,
  });
  const rateLimit = buildRateLimitPolicies({
    loginPerMinute: config.rateLimit.loginPerMinute,
    refreshPerMinute: config.rateLimit.refreshPerMinute,
    productsPerMinute: config.rateLimit.productsPerMinute,
  });

  return {
    config,
    logger,
    seeding: { users, products, passwordHasher, clock, idGenerator },
    policies: { lockout, rateLimit },
    useCases: {
      authenticateUser: new AuthenticateUser({
        users,
        passwordHasher,
        refreshTokens,
        sessionIssuer,
        clock,
        logger,
        lockoutPolicy: lockout,
        inertPasswordHash: INERT_PASSWORD_HASH,
      }),
      refreshSession: new RefreshSession({
        refreshTokens,
        secureTokens,
        sessionIssuer,
        clock,
        logger,
      }),
      logout: new Logout({ refreshTokens, secureTokens, clock, logger }),
      listProducts: new ListProducts({ products }),
    },
    services: {
      rateLimiter: new RateLimiter({
        store: rateLimiterStore,
        clock,
        logger,
        failOpen: config.rateLimit.failOpen,
      }),
      readiness,
      tokenSigner,
      errorReporter: observability.errorReporter,
      metrics: observability.metrics,
    },
  };
}

interface Persistence {
  readonly users: SeedableUserRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly products: SeedableProductRepository;
  readonly rateLimiterStore: RateLimiterStore;
  readonly readiness: ReadinessProbe;
}

/**
 * Escolhe os adaptadores de persistência.
 *
 * É o único ponto do projeto que sabe qual banco está em uso. Os casos de uso
 * recebem portas e não mudam nada quando a escolha muda — é a inversão de
 * dependência valendo na prática, e não só no diagrama.
 *
 * @throws quando produção pede armazenamento em memória. O estado viveria em
 *   uma instância só, sumiria a cada reinício e não seria compartilhado entre
 *   invocações do Lambda: sessões e contadores de bloqueio simplesmente não
 *   funcionariam, sem erro visível.
 */
function buildPersistence(config: AppConfig, cursors: CursorCodec, logger: Logger): Persistence {
  if (config.persistence.driver === 'memory') {
    if (config.isProduction) {
      throw new Error('Persistência em memória não pode ser usada em produção.');
    }

    return {
      users: new InMemoryUserRepository(),
      refreshTokens: new InMemoryRefreshTokenRepository(),
      products: new InMemoryProductRepository(cursors),
      rateLimiterStore: new InMemoryRateLimiterStore(),
      readiness: new AlwaysReadyProbe(),
    };
  }

  const { region, endpoint, tableName } = config.persistence;
  const { documents, base } = createClients({ region, endpoint });

  return {
    users: new DynamoDbUserRepository(documents, tableName),
    refreshTokens: new DynamoDbRefreshTokenRepository(documents, tableName),
    products: new DynamoDbProductRepository(documents, tableName, cursors),
    rateLimiterStore: new DynamoDbRateLimiterStore(documents, tableName),
    readiness: new DynamoDbReadinessProbe(base, tableName, logger),
  };
}

interface Observability {
  readonly errorReporter: ErrorReporter;
  readonly metrics: MetricsRecorder;
}

/**
 * Monta o relato de erro e a coleta de métricas.
 *
 * O Sentry só entra quando há DSN. Exigi-lo para subir obrigaria cada pessoa a
 * ter uma conta para rodar testes, e a alternativa comum — um DSN de brincadeira
 * commitado — polui o projeto real de alguém.
 *
 * As métricas ficam desligadas fora de produção pelo mesmo motivo prático: em
 * desenvolvimento elas só encheriam o terminal, já que não há CloudWatch lendo o
 * stdout.
 */
function buildObservability(config: AppConfig, logger: Logger, clock: Clock): Observability {
  const { sentryDsn, sentryTracesSampleRate } = config.observability;

  if (sentryDsn !== undefined) {
    SentryErrorReporter.initialise({
      dsn: sentryDsn,
      environment: config.nodeEnv,
      release: config.version,
      tracesSampleRate: sentryTracesSampleRate,
    });
  }

  return {
    errorReporter:
      sentryDsn === undefined ? new NoopErrorReporter() : new SentryErrorReporter(logger),
    metrics: config.isProduction
      ? new EmfMetricsRecorder(clock, config.nodeEnv)
      : new NoopMetricsRecorder(),
  };
}

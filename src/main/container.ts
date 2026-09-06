import { AuthenticateUser } from '../application/use-cases';
import { LockoutPolicy } from '../domain/value-objects';
import type { Logger } from '../domain/ports';
import {
  Argon2PasswordHasher,
  INERT_PASSWORD_HASH,
  JoseTokenSigner,
} from '../infrastructure/security';
import { InMemoryUserRepository } from '../infrastructure/persistence/in-memory/in-memory-user-repository';
import { SystemClock } from '../infrastructure/system/system-clock';
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
 * | #4    | `RefreshTokenRepository` e os casos de uso de sessão              |
 * | #5    | `ProductRepository` e a listagem paginada                        |
 * | #6    | `RateLimiterStore` e a política de limites                        |
 * | #7    | Cliente DynamoDB no lugar dos repositórios em memória             |
 * | #9    | `Logger` de verdade (pino) e o cliente do Sentry                  |
 */
export interface Container {
  readonly config: AppConfig;
  readonly policies: Policies;
  readonly useCases: UseCases;
}

export interface UseCases {
  readonly authenticateUser: AuthenticateUser;
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
  const passwordHasher = new Argon2PasswordHasher();
  const tokenSigner = new JoseTokenSigner({
    secret: config.auth.jwtSecret,
    issuer: config.auth.issuer,
    audience: config.auth.audience,
  });

  // A persistência real chega na issue #7. Até lá o repositório em memória
  // respeita o mesmo contrato, incluindo a concorrência otimista, então trocar
  // a implementação não altera nenhum caso de uso.
  const users = new InMemoryUserRepository();

  return {
    config,
    policies: { lockout },
    useCases: {
      authenticateUser: new AuthenticateUser({
        users,
        passwordHasher,
        tokenSigner,
        clock,
        logger,
        lockoutPolicy: lockout,
        accessTokenTtlSeconds: config.auth.accessTtlSeconds,
        inertPasswordHash: INERT_PASSWORD_HASH,
      }),
    },
  };
}

import { LockoutPolicy } from '../domain/value-objects';
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
 * | #3    | `PasswordHasher` (argon2id), `TokenSigner` (jose) e o login       |
 * | #4    | `RefreshTokenRepository` e os casos de uso de sessão              |
 * | #5    | `ProductRepository` e a listagem paginada                        |
 * | #6    | `RateLimiterStore` e a política de limites                        |
 * | #7    | Cliente DynamoDB e os repositórios concretos                     |
 * | #9    | `Logger` (pino) e o cliente do Sentry                             |
 */
export interface Container {
  readonly config: AppConfig;
  readonly policies: Policies;
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
export function buildContainer(config: AppConfig): Container {
  return {
    config,
    policies: {
      lockout: LockoutPolicy.create({
        maxAttempts: config.lockout.maxAttempts,
        baseDelayMs: config.lockout.baseDelayMs,
        maxDelayMs: config.lockout.maxDelayMs,
      }),
    },
  };
}

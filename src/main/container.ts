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
 * | Issue | O que passa a ser montado aqui                                  |
 * | ----- | --------------------------------------------------------------- |
 * | #3    | `PasswordHasher` (argon2id), `TokenSigner` (jose) e o login      |
 * | #4    | `RefreshTokenRepository` e os casos de uso de sessão             |
 * | #5    | `ProductRepository` e a listagem paginada                        |
 * | #6    | `RateLimiterStore` e a política de limites                       |
 * | #7    | Cliente DynamoDB e os repositórios concretos                     |
 * | #9    | `Logger` (pino) e o cliente do Sentry                            |
 */
export interface Container {
  readonly config: AppConfig;
}

/**
 * Monta o grafo de dependências da aplicação a partir da configuração validada.
 *
 * Recebe a configuração pronta em vez de ler `process.env` por dentro: assim os
 * testes montam o container com qualquer cenário sem tocar no ambiente do
 * processo, e o entrypoint continua sendo o único responsável por carregar o
 * ambiente de verdade.
 */
export function buildContainer(config: AppConfig): Container {
  return { config };
}

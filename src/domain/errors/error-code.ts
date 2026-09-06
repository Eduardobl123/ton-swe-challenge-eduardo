/**
 * Registro central dos códigos de erro da aplicação.
 *
 * Todo erro carrega um código estável, e é ele — não a mensagem — que o cliente
 * usa para decidir o que fazer. Mensagem é para humano e pode mudar; código é
 * contrato.
 *
 * A união vive aqui, e não espalhada por cada classe, para que o tradutor de
 * erro em HTTP (issue #8) possa ser exaustivo: acrescentar um código sem mapeá-lo
 * vira erro de compilação, em vez de virar um 500 genérico em produção.
 *
 * O código de rate limit consta desta lista embora a classe correspondente viva
 * em `src/application/errors` — o registro é compartilhado, a classe não.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_CURSOR',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'CONCURRENT_MODIFICATION',
  'RATE_LIMIT_EXCEEDED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

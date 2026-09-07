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
 * Alguns códigos não têm classe de erro correspondente: são produzidos pela
 * borda HTTP, que é onde a autenticação por token e o roteamento acontecem
 * (issue #8). O registro é compartilhado; as classes ficam onde o erro nasce.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'INVALID_CURSOR',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'CONCURRENT_MODIFICATION',
  'RATE_LIMIT_EXCEEDED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

import { AppError } from '../../domain/errors';
import type { ErrorCode } from '../../domain/errors';

/**
 * Tradução de código de erro para status HTTP.
 *
 * A tabela é exaustiva por construção: `Record<ErrorCode, number>` não compila
 * se um código do registro ficar de fora. Sem isso, acrescentar um erro novo e
 * esquecer de mapeá-lo produziria um 500 genérico descoberto em produção — e o
 * cliente receberia "erro interno" para uma recusa perfeitamente prevista.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_CURSOR: 400,
  UNAUTHENTICATED: 401,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  REFRESH_TOKEN_INVALID: 401,
  NOT_FOUND: 404,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,

  // Nunca chegam ao cliente: os casos de uso os convertem antes de sair. Estão
  // aqui só para manter a tabela exaustiva, e o status é o da resposta que os
  // substitui. Ver `docs/errors.md`.
  ACCOUNT_LOCKED: 401,
  REFRESH_TOKEN_REUSE_DETECTED: 401,
  CONCURRENT_MODIFICATION: 500,
};

const TITLE_BY_CODE: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Requisição inválida.',
  INVALID_CURSOR: 'Cursor de paginação inválido ou expirado.',
  UNAUTHENTICATED: 'Autenticação obrigatória.',
  TOKEN_INVALID: 'Token de acesso inválido.',
  TOKEN_EXPIRED: 'Token de acesso expirado.',
  NOT_FOUND: 'Recurso não encontrado.',
  RATE_LIMIT_EXCEEDED: 'Limite de requisições excedido.',
  INTERNAL_ERROR: 'Erro interno.',
};

/**
 * Corpo de erro no formato da RFC 9457.
 *
 * O `code` é o que o cliente deve programar contra: `title` e `detail` são para
 * humanos e podem mudar. O `requestId` liga esta resposta ao log e ao evento no
 * Sentry, o que transforma "deu erro aqui" em uma busca de um comando só.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly instance: string;
  readonly requestId: string;
  /** Campos que falharam na validação. Ausente nos demais erros. */
  readonly errors?: readonly ProblemFieldError[];
}

export interface ProblemFieldError {
  readonly field: string;
  readonly message: string;
}

export function statusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export interface ProblemInput {
  readonly code: ErrorCode;
  readonly instance: string;
  readonly requestId: string;
  readonly title?: string;
  readonly errors?: readonly ProblemFieldError[];
}

export function problemDetails({
  code,
  instance,
  requestId,
  title,
  errors,
}: ProblemInput): ProblemDetails {
  const status = statusFor(code);

  return {
    // URI de identificação do tipo de problema, como a RFC pede. Não é
    // endereço de rede e não precisa resolver.
    type: `https://ton-swe-challenge/errors/${code.toLowerCase().replaceAll('_', '-')}`,
    title: title ?? TITLE_BY_CODE[code] ?? 'Erro.',
    status,
    code,
    instance,
    requestId,
    ...(errors === undefined ? {} : { errors }),
  };
}

/**
 * Converte um erro previsto da aplicação em corpo de resposta.
 *
 * Erros que não estendem `AppError` não passam por aqui: são falhas imprevistas,
 * viram 500 genérico e têm o detalhe registrado apenas no log. Devolver a
 * mensagem de uma exceção não tratada entregaria caminho de arquivo, nome de
 * tabela e afins.
 */
export function fromAppError(error: AppError, instance: string, requestId: string): ProblemDetails {
  return problemDetails({ code: error.code, instance, requestId, title: error.message });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

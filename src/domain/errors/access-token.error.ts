import { DomainError } from './app-error';

/**
 * Nenhuma credencial foi apresentada.
 *
 * Distinto de token inválido: aqui o cliente simplesmente não tentou, e a
 * resposta o instrui a autenticar. Confundir os dois faria um cliente sem
 * sessão ficar tentando renovar um token que nunca teve.
 */
export class UnauthenticatedError extends DomainError {
  constructor() {
    super('UNAUTHENTICATED', 'Autenticação obrigatória.');
  }
}

/**
 * O token existe, mas não serve.
 *
 * Assinatura que não confere, emissor ou público divergentes, formato quebrado.
 * A resposta manda autenticar de novo, porque renovar não resolveria: o próximo
 * token teria o mesmo problema.
 */
export class AccessTokenInvalidError extends DomainError {
  constructor() {
    super('TOKEN_INVALID', 'Token de acesso inválido.');
  }
}

/**
 * O token era válido e venceu.
 *
 * Separado de inválido de propósito. O cliente já tem o token e pode lê-lo
 * sozinho, então dizer que expirou não vaza nada — e é justamente isso que o
 * instrui a renovar em vez de pedir a senha ao usuário.
 */
export class AccessTokenExpiredError extends DomainError {
  constructor() {
    super('TOKEN_EXPIRED', 'Token de acesso expirado.');
  }
}

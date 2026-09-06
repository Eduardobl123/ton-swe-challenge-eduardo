import { DomainError } from './app-error';

/**
 * O refresh token apresentado não serve para renovar a sessão.
 *
 * Cobre token inexistente, expirado, já revogado e já rotacionado. Assim como no
 * login, a resposta é única: distinguir "não existe" de "existe mas expirou"
 * ajudaria a mapear tokens válidos por tentativa e erro.
 */
export class InvalidRefreshTokenError extends DomainError {
  constructor() {
    super('REFRESH_TOKEN_INVALID', 'Refresh token inválido ou expirado.');
  }
}

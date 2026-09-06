import { DomainError } from './app-error';

/**
 * Um refresh token já rotacionado foi apresentado de novo.
 *
 * Como cada token só pode ser usado uma vez (ADR 0006), a reapresentação
 * significa que existe uma cópia circulando: ou o token vazou, ou o cliente
 * legítimo repetiu uma requisição. Não há como distinguir os dois casos, e a
 * resposta é a mesma — revogar a família inteira e exigir nova autenticação.
 *
 * **Este erro nunca chega ao cliente**, que recebe `InvalidRefreshTokenError`.
 * Informar "detectamos reuso" avisaria o atacante de que ele foi percebido.
 * Internamente ele vira evento de segurança com identificador da família.
 */
export class RefreshTokenReuseDetectedError extends DomainError {
  constructor(
    public readonly userId: string,
    public readonly familyId: string,
  ) {
    super('REFRESH_TOKEN_REUSE_DETECTED', 'Reuso de refresh token detectado.', {
      userId,
      familyId,
    });
  }
}

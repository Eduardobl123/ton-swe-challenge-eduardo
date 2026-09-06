import { DomainError } from './app-error';

/**
 * A conta está temporariamente bloqueada por tentativas malsucedidas.
 *
 * **Este erro nunca chega ao cliente.** O caso de uso de login o captura, emite
 * log e métrica, e responde com `InvalidCredentialsError` — indistinguível de
 * senha errada. Ele existe como tipo para que a decisão fique explícita no
 * código e testável, e não escondida atrás de um `if` mudo.
 *
 * Ver ADR 0010.
 */
export class AccountLockedError extends DomainError {
  constructor(
    /** Instante em que o bloqueio expira. Só para log e métrica. */
    public readonly lockedUntil: Date,
  ) {
    super('ACCOUNT_LOCKED', 'Conta temporariamente bloqueada.', {
      lockedUntil: lockedUntil.toISOString(),
    });
  }
}

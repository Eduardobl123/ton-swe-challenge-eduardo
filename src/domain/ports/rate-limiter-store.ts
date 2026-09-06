export interface RateLimitHit {
  /** Total de requisições contabilizadas na janela corrente, incluindo esta. */
  readonly count: number;
  /** Instante em que a janela vira e a cota se renova. */
  readonly resetAt: Date;
}

/**
 * Contador distribuído de requisições por chave e janela.
 *
 * O contrato exige que `hit` seja **atômico**: registrar e devolver o total em
 * uma única operação. Ler para depois escrever perderia contagem sob
 * concorrência, que é justamente a situação em que o limite precisa funcionar.
 *
 * A chave é opaca para o armazenamento. Quem chama decide se ela identifica um
 * usuário ou uma origem, o que permite cotas diferentes para o login e para a
 * listagem (ADR 0005).
 */
export interface RateLimiterStore {
  /** @throws quando o armazenamento falha. A política de fail-open é do chamador. */
  hit(key: string, windowMs: number, now: Date): Promise<RateLimitHit>;
}

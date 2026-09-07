export interface RateLimitWindows {
  /** Total da janela em curso, já incluindo a requisição que acabou de chegar. */
  readonly current: number;
  /**
   * Total da janela imediatamente anterior, ou zero quando não houve tráfego
   * nela.
   *
   * É o que permite aproximar uma janela deslizante sem guardar a lista de
   * instantes de cada requisição: a contagem anterior entra ponderada pela
   * fração que ainda pertence ao intervalo observado.
   */
  readonly previous: number;
  /** Início da janela em curso, alinhado ao tamanho dela. */
  readonly windowStartedAt: Date;
}

/**
 * Contador distribuído de requisições por chave e janela.
 *
 * O contrato exige que o incremento da janela em curso seja **atômico**. Ler
 * para depois escrever perderia contagem sob concorrência, que é exatamente a
 * situação em que o limite precisa funcionar — o mesmo erro que enfraquecia o
 * bloqueio de conta antes da correção na issue #3.
 *
 * O armazenamento não decide nada: ele conta e devolve. Se a requisição passa
 * ou não é decisão da camada de aplicação, que aplica a política. Isso mantém o
 * algoritmo em um lugar só, testável com relógio controlado, em vez de
 * reimplementado em cada adaptador com risco de divergirem.
 *
 * A chave é opaca. Quem chama decide se ela identifica um usuário ou uma
 * origem, o que permite cotas diferentes para o login e para a listagem
 * (ADR 0005).
 */
export interface RateLimiterStore {
  /**
   * Contabiliza uma requisição e devolve os totais das duas janelas relevantes.
   *
   * @throws quando o armazenamento falha. A política de fail-open é do chamador.
   */
  hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindows>;
}

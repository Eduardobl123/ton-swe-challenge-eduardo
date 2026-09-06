export interface ListProductsInput {
  /** Ausente usa o padrão; valores fora da faixa são ajustados, não recusados. */
  readonly limit: number | undefined;
  /** Continuação opaca devolvida na página anterior. Ausente na primeira. */
  readonly cursor: string | undefined;
}

/**
 * Produto como o cliente o vê.
 *
 * Deliberadamente diferente da entidade. O campo `active` não aparece porque a
 * listagem só devolve produtos ativos: expor a bandeira seria ruído, e sinalizar
 * a existência de itens inativos sem poder consultá-los é pior que omiti-los.
 * Datas saem em ISO-8601, não como `Date`, para que o contrato não dependa de
 * como cada camada serializa.
 */
export interface ProductView {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  /** Preço em centavos inteiros. Formatar é responsabilidade de quem exibe. */
  readonly priceCents: number;
  readonly createdAt: string;
}

export interface ListProductsOutput {
  readonly data: readonly ProductView[];
  readonly page: ProductPageInfo;
}

export interface ProductPageInfo {
  /** Tamanho efetivamente aplicado, que pode diferir do pedido. */
  readonly limit: number;
  /**
   * Ausente quando não há mais nada adiante.
   *
   * Substitui a contagem total: saber se existe próxima página é o que a
   * navegação precisa, e obter o total no DynamoDB custaria uma varredura
   * completa a cada requisição (ADR 0004).
   */
  readonly nextCursor: string | undefined;
  readonly hasMore: boolean;
  /**
   * Verdadeiro quando o `limit` pedido foi ajustado para o teto.
   *
   * A borda HTTP transforma isso no cabeçalho `X-Limit-Clamped`, para que o
   * cliente perceba que recebeu menos do que pediu sem precisar comparar
   * tamanhos.
   */
  readonly limitClamped: boolean;
}

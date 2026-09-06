import type { Product } from '../entities';
import type { PageCursor } from '../value-objects';

export interface ListActiveProductsQuery {
  /** Quantidade máxima de itens da página. Já validada e limitada pela borda. */
  readonly limit: number;
  /** Continuação de uma página anterior. Ausente na primeira página. */
  readonly cursor: PageCursor | undefined;
}

export interface ProductPage {
  readonly items: readonly Product[];
  /** Ausente quando esta é a última página. */
  readonly nextCursor: PageCursor | undefined;
}

/**
 * Leitura do catálogo.
 *
 * A página não traz contagem total de propósito: obtê-la no DynamoDB custaria
 * uma varredura completa a cada requisição. `nextCursor` ausente já responde a
 * pergunta que a navegação realmente faz, que é se existe mais alguma coisa
 * adiante (ADR 0004).
 */
export interface ProductRepository {
  listActive(query: ListActiveProductsQuery): Promise<ProductPage>;
}

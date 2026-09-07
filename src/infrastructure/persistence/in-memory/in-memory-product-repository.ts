import { InvalidCursorError } from '../../../domain/errors';
import { PageCursor } from '../../../domain/value-objects';
import type { CursorCodec } from '../cursor-codec';
import type { Product } from '../../../domain/entities';
import type {
  ListActiveProductsQuery,
  ProductPage,
  ProductRepository,
} from '../../../domain/ports';

/**
 * Chave de ordenação total do catálogo.
 *
 * `createdAt` sozinho não basta: dois produtos criados no mesmo milissegundo
 * ficariam empatados, e a ordem entre eles poderia variar de uma requisição para
 * outra — o suficiente para que a paginação repita um item e pule outro. O `id`
 * desempata e torna a ordem determinística.
 *
 * O formato ISO-8601 ordena lexicograficamente na mesma sequência cronológica,
 * o que permite comparar como texto. É a mesma chave que o `GSI1SK` terá no
 * DynamoDB (ADR 0003), então o comportamento aqui e lá é o mesmo.
 */
function sortKey(product: Product): string {
  return `${product.createdAt.toISOString()}#${product.id}`;
}

/**
 * Comparação por unidade de código, e não por `localeCompare`.
 *
 * As duas discordam: para o comparador de locale, `'A'` vem depois de `'a'`;
 * para o operador `<`, vem antes. Ordenar por um e cortar a página pelo outro
 * faria a janela pular ou repetir item assim que um identificador tivesse caixa
 * mista — e o teste com ids minúsculos jamais perceberia.
 *
 * O DynamoDB ordena a chave de classificação por bytes, então esta é também a
 * semântica que o adaptador real terá (issue #7).
 */
function compareKeys(a: string, b: string): number {
  // Nunca devolve zero porque a chave é única por construção: ela termina no
  // identificador do produto, que é a chave do próprio mapa.
  return a < b ? -1 : 1;
}

/** Aceita apenas o que este repositório mesmo emitiu. */
const SORT_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#.+$/;

/**
 * Catálogo em memória com paginação por cursor de verdade.
 *
 * A tentação aqui seria devolver uma fatia de um array e chamar isso de
 * paginação. Um duplo assim passaria em todos os testes e esconderia justamente
 * o que precisa ser provado: que percorrer as páginas não repete nem pula item
 * quando o catálogo muda no meio do caminho. O defeito só apareceria contra o
 * DynamoDB, na issue #7.
 *
 * Por isso este adaptador ordena, corta pela chave e codifica o cursor com as
 * mesmas regras que o adaptador real vai usar.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Product>();

  constructor(
    private readonly cursors: CursorCodec,
    seed: readonly Product[] = [],
  ) {
    for (const product of seed) {
      this.byId.set(product.id, product);
    }
  }

  private encodeCursor(product: Product): PageCursor {
    return PageCursor.create(this.cursors.encode(sortKey(product)));
  }

  /**
   * @throws {InvalidCursorError} para qualquer coisa que não seja um cursor
   *   emitido aqui: o codificador recusa o que foi adulterado ou cifrado com
   *   outro segredo, e a forma da chave recusa o resto.
   */
  private decodeCursor(cursor: PageCursor): string {
    const decoded = this.cursors.decode(cursor.value);

    if (!SORT_KEY_SHAPE.test(decoded)) {
      throw new InvalidCursorError();
    }

    return decoded;
  }

  public add(product: Product): void {
    this.byId.set(product.id, product);
  }

  public listActive({ limit, cursor }: ListActiveProductsQuery): Promise<ProductPage> {
    // Mais recentes primeiro, que é a ordem em que um catálogo é consumido.
    const ordered = [...this.byId.values()]
      .filter((product) => product.active)
      .sort((a, b) => compareKeys(sortKey(b), sortKey(a)));

    const after = cursor === undefined ? undefined : this.decodeCursor(cursor);
    const remaining =
      after === undefined ? ordered : ordered.filter((product) => sortKey(product) < after);

    // Lê um item além do pedido apenas para saber se há próxima página, sem
    // precisar contar o catálogo inteiro.
    const window = remaining.slice(0, limit + 1);
    const items = window.slice(0, limit);
    const hasMore = window.length > limit;
    const last = items.at(-1);

    return Promise.resolve({
      items,
      nextCursor: hasMore && last !== undefined ? this.encodeCursor(last) : undefined,
    });
  }
}

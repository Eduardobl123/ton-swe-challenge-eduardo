import { PageCursor } from '../../domain/value-objects';
import { ValidationError } from '../../domain/errors';
import type { Product } from '../../domain/entities';
import type { ProductRepository } from '../../domain/ports';
import type { ListProductsInput, ListProductsOutput, ProductView } from '../dto';

/** Tamanho de página quando o cliente não pede nada. */
const DEFAULT_LIMIT = 20;

/**
 * Teto de itens por página.
 *
 * Não é preferência estética: cada item custa leitura no DynamoDB e banda na
 * resposta, e uma página sem limite deixa o custo da requisição nas mãos de
 * quem chama.
 */
const MAX_LIMIT = 100;

export interface ListProductsDependencies {
  readonly products: ProductRepository;
}

/**
 * Lista os produtos ativos, uma página por vez.
 *
 * ## Por que cursor e não número de página
 *
 * Com `offset`, pular para a página 7 exige percorrer e descartar as seis
 * anteriores — custo que cresce com a profundidade, e que o DynamoDB nem
 * oferece. Pior: a janela desliza quando alguém insere ou remove um item entre
 * duas requisições, e o cliente vê o mesmo produto duas vezes ou pula outro sem
 * perceber.
 *
 * O cursor marca uma posição na ordenação, não uma contagem. O custo é o mesmo
 * em qualquer página, e uma inserção concorrente não desloca o que já foi lido.
 * Ver ADR 0004.
 *
 * ## O que o caso de uso sabe sobre o cursor
 *
 * Nada além de que é um texto opaco. Como ele é codificado, e o que carrega
 * dentro, é assunto exclusivo do adaptador de persistência. É isso que permite
 * trocar a estratégia, ou o próprio banco, sem alterar este arquivo nem o
 * contrato da API.
 */
export class ListProducts {
  constructor(private readonly deps: ListProductsDependencies) {}

  public async execute(input: ListProductsInput): Promise<ListProductsOutput> {
    const { limit, clamped } = resolveLimit(input.limit);
    // Parâmetro presente e vazio equivale a ausente. Um cliente que monte a URL
    // como `?cursor=${next ?? ''}` manda vazio na primeira página, e recusá-lo
    // devolveria erro justamente na primeira requisição. É a mesma regra que o
    // leitor de ambiente já aplica.
    const requestedCursor = input.cursor?.trim();
    const cursor =
      requestedCursor === undefined || requestedCursor.length === 0
        ? undefined
        : PageCursor.create(requestedCursor);

    const page = await this.deps.products.listActive({ limit, cursor });

    return {
      data: page.items.map(toView),
      page: {
        limit,
        nextCursor: page.nextCursor?.value,
        hasMore: page.nextCursor !== undefined,
        limitClamped: clamped,
      },
    };
  }
}

/**
 * Ajusta o tamanho pedido em vez de recusá-lo.
 *
 * Um `limit=1000` é quase sempre otimismo, não ataque, e devolver cem itens
 * atende melhor do que um erro. O ajuste é informado na resposta para que o
 * cliente não conclua que chegou ao fim da lista ao receber menos do que pediu.
 *
 * @throws {ValidationError} quando o valor não é um número utilizável. Aí não há
 *   o que ajustar, e adivinhar a intenção seria pior que recusar.
 */
function resolveLimit(requested: number | undefined): { limit: number; clamped: boolean } {
  if (requested === undefined) {
    return { limit: DEFAULT_LIMIT, clamped: false };
  }

  if (!Number.isFinite(requested)) {
    throw new ValidationError('limit', 'Tamanho de página deve ser um número.');
  }

  const truncated = Math.trunc(requested);
  const limit = Math.min(Math.max(truncated, 1), MAX_LIMIT);

  return { limit, clamped: truncated > MAX_LIMIT };
}

function toView(product: Product): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCents: product.price.cents,
    createdAt: product.createdAt.toISOString(),
  };
}

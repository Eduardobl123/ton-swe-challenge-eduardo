import { Product } from '../../../domain/entities';
import { Money } from '../../../domain/value-objects';
import { keys } from './table';

export interface ProductItem {
  readonly pk: string;
  readonly sk: string;
  /** Ausente em produto inativo, que por isso não entra no índice da listagem. */
  readonly gsi1pk?: string;
  readonly gsi1sk?: string;
  readonly entity: 'Product';
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly priceCents: number;
  readonly active: boolean;
  readonly createdAt: string;
}

export function toProductItem(product: Product): ProductItem {
  const props = product.toProps();

  return {
    ...keys.product(props.id),
    // A chave do índice só existe quando o produto está ativo. O DynamoDB não
    // indexa item sem a chave, então a listagem nunca lê o que vai descartar.
    ...(props.active ? keys.activeProduct(props.createdAt, props.id) : {}),
    entity: 'Product',
    id: props.id,
    sku: props.sku,
    name: props.name,
    description: props.description,
    priceCents: props.price.cents,
    active: props.active,
    createdAt: props.createdAt.toISOString(),
  };
}

export function toProduct(item: ProductItem): Product {
  return Product.create({
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    price: Money.fromCents(item.priceCents),
    active: item.active,
    createdAt: new Date(item.createdAt),
  });
}

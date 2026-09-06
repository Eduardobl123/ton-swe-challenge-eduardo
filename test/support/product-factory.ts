import { Product } from '../../src/domain/entities';
import { Money } from '../../src/domain/value-objects';

const BASE = new Date('2026-01-01T00:00:00.000Z');

/**
 * Produtos com data crescente e previsível.
 *
 * O índice vira minutos a partir da base, de modo que a ordem cronológica é
 * conhecida no teste sem depender do relógio.
 */
export function produto(indice: number, overrides: { active?: boolean } = {}): Product {
  return Product.create({
    id: `prod-${String(indice).padStart(3, '0')}`,
    sku: `TON-${String(indice).padStart(3, '0')}`,
    name: `Produto ${String(indice)}`,
    description: `Descrição do produto ${String(indice)}`,
    price: Money.fromCents(1000 + indice),
    active: overrides.active ?? true,
    createdAt: new Date(BASE.getTime() + indice * 60_000),
  });
}

export function catalogo(quantidade: number): Product[] {
  return Array.from({ length: quantidade }, (_, i) => produto(i + 1));
}

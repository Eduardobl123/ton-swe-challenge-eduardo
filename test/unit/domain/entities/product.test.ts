import { describe, expect, it } from 'vitest';
import { Product, type ProductProps } from '../../../../src/domain/entities';
import { Money } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

const AGORA = new Date('2026-09-06T12:00:00.000Z');

const criarProduto = (overrides: Partial<ProductProps> = {}): Product =>
  Product.create({
    id: 'prod-1',
    sku: 'TON-MAQ-001',
    name: 'Maquininha T3',
    description: 'Maquininha com Wi-Fi e chip.',
    price: Money.fromCents(19_900),
    active: true,
    createdAt: AGORA,
    ...overrides,
  });

describe('Product', () => {
  it('expõe os campos informados', () => {
    const produto = criarProduto();

    expect(produto.id).toBe('prod-1');
    expect(produto.sku).toBe('TON-MAQ-001');
    expect(produto.name).toBe('Maquininha T3');
    expect(produto.description).toBe('Maquininha com Wi-Fi e chip.');
    expect(produto.price.cents).toBe(19_900);
    expect(produto.active).toBe(true);
    expect(produto.createdAt).toEqual(AGORA);
  });

  it('remove espaços nas pontas do nome', () => {
    expect(criarProduto({ name: '  Maquininha T3  ' }).name).toBe('Maquininha T3');
  });

  describe('invariantes', () => {
    it.each([
      ['id vazio', { id: '   ' }],
      ['nome vazio', { name: '' }],
      ['nome só com espaços', { name: '   ' }],
      ['nome longo demais', { name: 'a'.repeat(201) }],
      ['descrição longa demais', { description: 'a'.repeat(2001) }],
    ])('recusa %s', (_caso, overrides) => {
      expect(() => criarProduto(overrides)).toThrow(ValidationError);
    });

    it.each([
      ['minúsculas', 'ton-maq-001'],
      ['curto demais', 'TN'],
      ['longo demais', 'T'.repeat(33)],
      ['com espaço', 'TON MAQ'],
      ['com acento', 'TON-MAQ-Ã'],
      ['começando com hífen', '-TON-001'],
      ['vazio', ''],
    ])('recusa SKU %s', (_caso, sku) => {
      expect(() => criarProduto({ sku })).toThrow(ValidationError);
    });

    it.each(['ABC', 'TON-MAQ-001', 'A1B2C3', 'T3X', 'A'.repeat(32)])('aceita SKU %s', (sku) => {
      expect(() => criarProduto({ sku })).not.toThrow();
    });

    it('aceita descrição vazia', () => {
      expect(() => criarProduto({ description: '' })).not.toThrow();
    });

    it('aceita produto gratuito', () => {
      expect(criarProduto({ price: Money.fromCents(0) }).price.cents).toBe(0);
    });
  });

  it('permite representar produto inativo', () => {
    // Existe no banco, mas fica fora da listagem pública.
    expect(criarProduto({ active: false }).active).toBe(false);
  });

  it('devolve uma cópia em toProps', () => {
    const produto = criarProduto();
    const props = produto.toProps();
    (props as { name: string }).name = 'alterado';
    props.createdAt.setFullYear(1999);

    expect(produto.name).toBe('Maquininha T3');
    expect(produto.createdAt).toEqual(AGORA);
  });

  it('não deixa alterar a criação pela data devolvida no getter', () => {
    const produto = criarProduto();

    produto.createdAt.setFullYear(1999);

    expect(produto.createdAt).toEqual(AGORA);
  });
});

import { describe, expect, it } from 'vitest';
import { ListProducts } from '../../../../src/application/use-cases';
import { InvalidCursorError, ValidationError } from '../../../../src/domain/errors';
import { InMemoryProductRepository } from '../../../../src/infrastructure/persistence/in-memory/in-memory-product-repository';
import { Product } from '../../../../src/domain/entities';
import { Money } from '../../../../src/domain/value-objects';
import { catalogo, produto } from '../../../support/product-factory';
import type { ListProductsOutput } from '../../../../src/application/dto';

const montar = (quantidade = 0): { useCase: ListProducts; products: InMemoryProductRepository } => {
  const products = new InMemoryProductRepository(catalogo(quantidade));

  return { useCase: new ListProducts({ products }), products };
};

const listar = (
  useCase: ListProducts,
  limit?: number,
  cursor?: string,
): Promise<ListProductsOutput> => useCase.execute({ limit, cursor });

describe('ListProducts', () => {
  describe('tamanho da página', () => {
    it('usa 20 itens quando nada é pedido', async () => {
      const { useCase } = montar(50);

      const saida = await listar(useCase);

      expect(saida.data).toHaveLength(20);
      expect(saida.page.limit).toBe(20);
      expect(saida.page.limitClamped).toBe(false);
    });

    it('respeita o tamanho pedido', async () => {
      const { useCase } = montar(50);

      expect((await listar(useCase, 5)).data).toHaveLength(5);
    });

    it('ajusta para o teto de 100 e sinaliza o ajuste', async () => {
      // Devolver cem atende melhor que um erro, mas o cliente precisa saber que
      // recebeu menos do que pediu — senão conclui que a lista acabou.
      const { useCase } = montar(150);

      const saida = await listar(useCase, 1000);

      expect(saida.data).toHaveLength(100);
      expect(saida.page.limit).toBe(100);
      expect(saida.page.limitClamped).toBe(true);
    });

    it.each([
      [0, 1],
      [-5, 1],
      [1.9, 1],
      [20.7, 20],
    ])('ajusta o pedido %s para %i', async (pedido, esperado) => {
      const { useCase } = montar(50);

      expect((await listar(useCase, pedido)).page.limit).toBe(esperado);
    });

    it('não marca ajuste quando o pedido só foi truncado', async () => {
      const { useCase } = montar(50);

      expect((await listar(useCase, 20.7)).page.limitClamped).toBe(false);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      'recusa %s, que não dá para ajustar',
      async (pedido) => {
        const { useCase } = montar(10);

        await expect(listar(useCase, pedido)).rejects.toBeInstanceOf(ValidationError);
      },
    );
  });

  describe('ordenação e conteúdo', () => {
    it('devolve os mais recentes primeiro', async () => {
      const { useCase } = montar(5);

      const saida = await listar(useCase);

      expect(saida.data.map((p) => p.id)).toEqual([
        'prod-005',
        'prod-004',
        'prod-003',
        'prod-002',
        'prod-001',
      ]);
    });

    it('omite produtos inativos', async () => {
      const products = new InMemoryProductRepository([
        produto(1),
        produto(2, { active: false }),
        produto(3),
      ]);

      const saida = await new ListProducts({ products }).execute({
        limit: undefined,
        cursor: undefined,
      });

      expect(saida.data.map((p) => p.id)).toEqual(['prod-003', 'prod-001']);
    });

    it('não expõe a bandeira de ativo nem campos internos', async () => {
      const { useCase } = montar(1);

      const [item] = (await listar(useCase)).data;

      expect(Object.keys(item!).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'name',
        'priceCents',
        'sku',
      ]);
    });

    it('devolve preço em centavos inteiros e data em ISO', async () => {
      const { useCase } = montar(1);

      const [item] = (await listar(useCase)).data;

      expect(item?.priceCents).toBe(1001);
      expect(item?.createdAt).toBe('2026-01-01T00:01:00.000Z');
    });
  });

  describe('navegação por cursor', () => {
    it('não devolve cursor quando tudo cabe em uma página', async () => {
      const { useCase } = montar(3);

      const saida = await listar(useCase, 10);

      expect(saida.page.nextCursor).toBeUndefined();
      expect(saida.page.hasMore).toBe(false);
    });

    it('devolve cursor enquanto houver mais itens', async () => {
      const { useCase } = montar(10);

      const saida = await listar(useCase, 4);

      expect(saida.page.nextCursor).toBeDefined();
      expect(saida.page.hasMore).toBe(true);
    });

    it('a última página não traz cursor', async () => {
      const { useCase } = montar(10);

      let cursor = (await listar(useCase, 4)).page.nextCursor;
      cursor = (await listar(useCase, 4, cursor)).page.nextCursor;
      const ultima = await listar(useCase, 4, cursor);

      expect(ultima.data).toHaveLength(2);
      expect(ultima.page.nextCursor).toBeUndefined();
      expect(ultima.page.hasMore).toBe(false);
    });

    it('percorre o catálogo inteiro sem repetir nem pular item', async () => {
      const { useCase } = montar(57);
      const vistos: string[] = [];
      let cursor: string | undefined;

      do {
        const pagina = await listar(useCase, 10, cursor);
        vistos.push(...pagina.data.map((p) => p.id));
        cursor = pagina.page.nextCursor;
      } while (cursor !== undefined);

      expect(vistos).toHaveLength(57);
      expect(new Set(vistos).size).toBe(57);
    });

    it('percorre corretamente um catálogo com identificadores de caixa mista', async () => {
      // Ordenar por localeCompare e cortar a página com `<` discorda em
      // maiúsculas contra minúsculas, e a janela passaria a pular ou repetir
      // item. Ids minúsculos escondem o problema.
      const criadoEm = new Date('2026-01-01T00:00:00.000Z');
      const products = new InMemoryProductRepository(
        ['Alpha', 'alpha', 'BETA', 'beta', 'Gama', 'gama'].map((id, i) =>
          Product.create({
            id,
            sku: `TON-${String(i + 1).padStart(3, '0')}`,
            name: id,
            description: '',
            price: Money.fromCents(100),
            active: true,
            createdAt: criadoEm,
          }),
        ),
      );
      const useCase = new ListProducts({ products });

      const vistos: string[] = [];
      let cursor: string | undefined;
      do {
        const pagina = await useCase.execute({ limit: 2, cursor });
        vistos.push(...pagina.data.map((p) => p.id));
        cursor = pagina.page.nextCursor;
      } while (cursor !== undefined);

      expect(vistos).toHaveLength(6);
      expect(new Set(vistos).size).toBe(6);
    });

    it('o cursor é opaco: não revela o formato interno da chave', async () => {
      const { useCase } = montar(5);

      const cursor = (await listar(useCase, 2)).page.nextCursor;

      expect(cursor).not.toContain('prod-');
      expect(cursor).not.toContain('2026-');
    });
  });

  describe('estabilidade sob escrita concorrente', () => {
    it('inserção durante a navegação não repete nem esconde item existente', async () => {
      // É o motivo de existir o cursor. Com deslocamento numérico, um item novo
      // empurraria a janela e o cliente veria o mesmo produto duas vezes.
      const { useCase, products } = montar(30);
      const vistos: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;

      do {
        const pagina = await listar(useCase, 10, cursor);
        vistos.push(...pagina.data.map((p) => p.id));
        cursor = pagina.page.nextCursor;
        paginas += 1;

        if (paginas === 1) {
          // Produto novo entra no topo da ordenação, já passada.
          products.add(produto(999));
        }
      } while (cursor !== undefined);

      const originais = vistos.filter((id) => id !== 'prod-999');
      expect(originais).toHaveLength(30);
      expect(new Set(originais).size).toBe(30);
    });

    it('remoção durante a navegação não pula o item seguinte', async () => {
      const { useCase, products } = montar(20);

      const primeira = await listar(useCase, 5);
      products.add(produto(12, { active: false }));

      const segunda = await listar(useCase, 5, primeira.page.nextCursor);

      // prod-012 sai por ter sido desativado; nenhum vizinho é arrastado junto.
      expect(segunda.data.map((p) => p.id)).toEqual([
        'prod-015',
        'prod-014',
        'prod-013',
        'prod-011',
        'prod-010',
      ]);
    });
  });

  describe('cursor inválido', () => {
    it.each([
      ['texto qualquer', 'nao-e-um-cursor'],
      ['base64 de outro conteúdo', Buffer.from('conteudo-forjado').toString('base64url')],
      ['chave com data malformada', Buffer.from('ontem#prod-1').toString('base64url')],
      ['chave sem identificador', Buffer.from('2026-01-01T00:00:00.000Z#').toString('base64url')],
    ])('recusa %s', async (_caso, cursor) => {
      const { useCase } = montar(10);

      await expect(listar(useCase, 10, cursor)).rejects.toBeInstanceOf(InvalidCursorError);
    });

    it('recusa cursor vazio', async () => {
      const { useCase } = montar(10);

      await expect(listar(useCase, 10, '   ')).rejects.toBeInstanceOf(InvalidCursorError);
    });

    it('não explica por que o cursor é inválido', async () => {
      // Detalhar entregaria o formato das chaves da tabela.
      const { useCase } = montar(10);

      await expect(listar(useCase, 10, 'invalido')).rejects.toThrow(
        /Cursor de paginação inválido ou expirado\./,
      );
    });
  });

  it('devolve página vazia quando não há catálogo', async () => {
    const { useCase } = montar(0);

    const saida = await listar(useCase);

    expect(saida.data).toEqual([]);
    expect(saida.page.hasMore).toBe(false);
  });
});

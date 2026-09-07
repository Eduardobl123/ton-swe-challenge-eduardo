import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DynamoDbProductRepository } from '../../src/infrastructure/persistence/dynamodb';
import { CursorCodec } from '../../src/infrastructure/persistence/cursor-codec';
import { InvalidCursorError } from '../../src/domain/errors';
import { PageCursor } from '../../src/domain/value-objects';
import { produto } from '../support/product-factory';
import { createTestTable, type TestTable } from './support';

const SEGREDO = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

let table: TestTable;
let repo: DynamoDbProductRepository;

describe('DynamoDbProductRepository', () => {
  beforeAll(async () => {
    table = await createTestTable('products');
    repo = new DynamoDbProductRepository(
      table.clients.documents,
      table.tableName,
      new CursorCodec(SEGREDO),
    );

    for (let i = 1; i <= 25; i += 1) {
      // Um em cada cinco inativo, para que o filtro tenha o que filtrar.
      await repo.add(produto(i, { active: i % 5 !== 0 }));
    }
  });

  afterAll(async () => {
    await table.drop();
  });

  it('devolve os mais recentes primeiro', async () => {
    const { items } = await repo.listActive({ limit: 3, cursor: undefined });

    expect(items.map((p) => p.id)).toEqual(['prod-024', 'prod-023', 'prod-022']);
  });

  it('não devolve produto inativo', async () => {
    const { items } = await repo.listActive({ limit: 25, cursor: undefined });

    expect(items.every((p) => p.active)).toBe(true);
    expect(items).toHaveLength(20);
  });

  it('percorre todas as páginas sem repetir nem pular item', async () => {
    const vistos: string[] = [];
    let cursor = undefined as PageCursor | undefined;

    do {
      const pagina = await repo.listActive({ limit: 4, cursor });
      vistos.push(...pagina.items.map((p) => p.id));
      cursor = pagina.nextCursor;
    } while (cursor !== undefined);

    expect(vistos).toHaveLength(20);
    expect(new Set(vistos).size).toBe(20);
  });

  it('não devolve cursor na última página', async () => {
    const { nextCursor } = await repo.listActive({ limit: 100, cursor: undefined });

    expect(nextCursor).toBeUndefined();
  });

  it('o cursor não revela a chave de continuação', async () => {
    // Ele carrega pk, sk e as chaves do índice: em claro, publicaria o desenho
    // interno da tabela em toda resposta paginada.
    const { nextCursor } = await repo.listActive({ limit: 2, cursor: undefined });

    const decodificado = Buffer.from(nextCursor!.value, 'base64url').toString('utf8');
    expect(decodificado).not.toContain('PRODUCT#');
    expect(decodificado).not.toContain('gsi1');
  });

  it('recusa cursor cifrado com outro segredo', async () => {
    const alheio = new DynamoDbProductRepository(
      table.clients.documents,
      table.tableName,
      new CursorCodec('outro-segredo-completamente-diferente-com-32'),
    );
    const { nextCursor } = await alheio.listActive({ limit: 2, cursor: undefined });

    await expect(repo.listActive({ limit: 2, cursor: nextCursor })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it('recusa cursor cujo conteúdo não é uma chave de continuação', async () => {
    // Cenário de implantação gradual: versão anterior emitiu outro formato,
    // cifrado com o mesmo segredo.
    const antigo = PageCursor.create(new CursorCodec(SEGREDO).encode('{"formato":"antigo"}'));

    await expect(repo.listActive({ limit: 2, cursor: antigo })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it('preserva preço e data na ida e na volta', async () => {
    const { items } = await repo.listActive({ limit: 1, cursor: undefined });

    expect(items[0]?.price.cents).toBe(1024);
    expect(items[0]?.createdAt.toISOString()).toBe('2026-01-01T00:24:00.000Z');
  });
});

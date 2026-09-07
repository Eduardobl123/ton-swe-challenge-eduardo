import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbRateLimiterStore } from '../../src/infrastructure/persistence/dynamodb';
import { createTestTable, type TestTable } from './support';

const MINUTO = 60_000;
const INICIO = new Date('2026-09-06T12:00:30.000Z');

let table: TestTable;
let store: DynamoDbRateLimiterStore;
let sufixo = 0;

const chave = (): string => `k-${String((sufixo += 1))}`;

describe('DynamoDbRateLimiterStore', () => {
  beforeAll(async () => {
    table = await createTestTable('ratelimit');
    store = new DynamoDbRateLimiterStore(table.clients.documents, table.tableName);
  });

  afterAll(async () => {
    await table.drop();
  });

  it('conta a primeira requisição da chave', async () => {
    const resultado = await store.hit(chave(), MINUTO, INICIO);

    expect(resultado.current).toBe(1);
    expect(resultado.previous).toBe(0);
  });

  it('alinha a janela ao relógio, não à primeira requisição', async () => {
    // É o que faz instâncias diferentes concordarem sobre onde uma janela
    // começa — sem isso, cada processo teria a sua e o limite global não fecharia.
    const resultado = await store.hit(chave(), MINUTO, INICIO);

    expect(resultado.windowStartedAt).toEqual(new Date('2026-09-06T12:00:00.000Z'));
  });

  it('acumula dentro da mesma janela', async () => {
    const k = chave();
    await store.hit(k, MINUTO, INICIO);

    const segundo = await store.hit(k, MINUTO, new Date(INICIO.getTime() + 1_000));

    expect(segundo.current).toBe(2);
  });

  it('preserva a contagem ao passar para a janela seguinte', async () => {
    const k = chave();
    await store.hit(k, MINUTO, INICIO);
    await store.hit(k, MINUTO, INICIO);

    const proxima = await store.hit(k, MINUTO, new Date(INICIO.getTime() + MINUTO));

    expect(proxima.current).toBe(1);
    expect(proxima.previous).toBe(2);
  });

  it('descarta contagem depois de um intervalo sem tráfego', async () => {
    const k = chave();
    await store.hit(k, MINUTO, INICIO);

    const depois = await store.hit(k, MINUTO, new Date(INICIO.getTime() + 5 * MINUTO));

    expect(depois.previous).toBe(0);
  });

  it('mantém chaves independentes', async () => {
    const a = chave();
    await store.hit(a, MINUTO, INICIO);
    await store.hit(a, MINUTO, INICIO);

    expect((await store.hit(chave(), MINUTO, INICIO)).current).toBe(1);
  });

  it('não perde contagem sob cem requisições simultâneas', async () => {
    // O incremento é feito pelo banco justamente para isto: ler e regravar
    // perderia contagem exatamente quando o limite precisa funcionar.
    const k = chave();

    await Promise.all(Array.from({ length: 100 }, () => store.hit(k, MINUTO, INICIO)));

    expect((await store.hit(k, MINUTO, INICIO)).current).toBe(101);
  });

  it('grava prazo de expurgo no item', async () => {
    const k = chave();
    await store.hit(k, MINUTO, INICIO);

    const { Item } = await table.clients.documents.send(
      new GetCommand({
        TableName: table.tableName,
        Key: {
          pk: `RL#${k}#${String(Math.floor(INICIO.getTime() / MINUTO) * MINUTO)}`,
          sk: 'COUNTER',
        },
      }),
    );

    const item = Item as { ttl?: number } | undefined;
    expect(Number(item?.ttl)).toBeGreaterThan(Math.floor(INICIO.getTime() / 1000));
  });
});

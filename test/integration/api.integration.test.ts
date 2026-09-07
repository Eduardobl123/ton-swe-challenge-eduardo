import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product, User } from '../../src/domain/entities';
import { Email, Money } from '../../src/domain/value-objects';
import { buildApp } from '../../src/infrastructure/http/app';
import { loadConfig } from '../../src/infrastructure/config/env';
import { buildContainer } from '../../src/main/container';
import { RecordingLogger } from '../support/fakes';
import { createTestTable, type TestTable } from './support';
import type { FastifyInstance } from 'fastify';

const EMAIL = 'demo@ton.com.br';
const SENHA = 'Desafio@Ton2026';

let table: TestTable;
let app: FastifyInstance;

/**
 * A jornada completa contra o banco de verdade.
 *
 * Os testes com `app.inject` provam a borda HTTP com adaptadores em memória; a
 * suíte de repositórios prova cada consulta isolada. O que só aparece aqui é a
 * composição: chaves montadas em um lado e consultadas no outro, mapeadores
 * usados nos dois sentidos, e a paginação atravessando cursor cifrado, índice e
 * serialização.
 */
describe('API contra DynamoDB', () => {
  beforeAll(async () => {
    table = await createTestTable('api');

    const container = buildContainer(
      loadConfig({
        JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
        TABLE_NAME: table.tableName,
        PERSISTENCE: 'dynamodb',
        DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
        SWAGGER_ENABLED: 'false',
      }),
      new RecordingLogger(),
    );

    const { users, products, passwordHasher, clock, idGenerator } = container.seeding;
    const agora = clock.now();

    await users.save(
      User.create({
        id: idGenerator.next(),
        email: Email.create(EMAIL),
        passwordHash: await passwordHasher.hash(SENHA),
        failedLoginAttempts: 0,
        lockedUntil: undefined,
        createdAt: agora,
        version: 0,
      }),
    );

    for (let i = 1; i <= 12; i += 1) {
      await products.add(
        Product.create({
          id: `p-${String(i).padStart(3, '0')}`,
          sku: `TON-${String(i).padStart(3, '0')}`,
          name: `Produto ${String(i)}`,
          description: '',
          price: Money.fromCents(1_000 + i),
          active: true,
          createdAt: new Date(agora.getTime() - (12 - i) * 60_000),
        }),
      );
    }

    app = await buildApp(container);
  });

  afterAll(async () => {
    await app.close();
    await table.drop();
  });

  const entrar = async (senha = SENHA) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: EMAIL, password: senha },
    });

  it('a sonda de prontidão confirma que a tabela responde', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/ready' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: 'ready' });
  });

  it('autentica e devolve o par de credenciais', async () => {
    const resposta = await entrar();

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ refreshToken: string }>().refreshToken).toBeTruthy();
  });

  it('recusa senha errada', async () => {
    const resposta = await entrar('senha-errada-mas-longa');

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('percorre o catálogo inteiro pelo cursor, sem repetir item', async () => {
    const { accessToken } = (await entrar()).json<{ accessToken: string }>();
    const vistos: string[] = [];
    let cursor: string | undefined;

    do {
      const pagina = await app.inject({
        method: 'GET',
        url: `/v1/products?limit=5${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const corpo = pagina.json<{
        data: { sku: string }[];
        page: { nextCursor?: string };
      }>();
      vistos.push(...corpo.data.map((p) => p.sku));
      cursor = corpo.page.nextCursor;
    } while (cursor !== undefined);

    expect(vistos).toHaveLength(12);
    expect(new Set(vistos).size).toBe(12);
  });

  it('renova a sessão e invalida o token anterior', async () => {
    const sessao = (await entrar()).json<{ refreshToken: string }>();

    const renovada = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: sessao.refreshToken },
    });
    const reuso = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: sessao.refreshToken },
    });

    expect(renovada.statusCode).toBe(200);
    expect(reuso.statusCode).toBe(401);
  });

  it('o reuso derruba também o token emitido na renovação', async () => {
    const sessao = (await entrar()).json<{ refreshToken: string }>();
    const nova = (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: sessao.refreshToken },
      })
    ).json<{ refreshToken: string }>();

    await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: sessao.refreshToken },
    });

    const depois = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: nova.refreshToken },
    });
    expect(depois.statusCode).toBe(401);
  });

  it('o logout encerra a sessão', async () => {
    const sessao = (await entrar()).json<{ accessToken: string; refreshToken: string }>();

    const saida = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${sessao.accessToken}` },
      payload: { refreshToken: sessao.refreshToken },
    });
    const depois = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: sessao.refreshToken },
    });

    expect(saida.statusCode).toBe(204);
    expect(depois.statusCode).toBe(401);
  });

  it('aplica a cota por usuário', async () => {
    const { accessToken } = (await entrar()).json<{ accessToken: string }>();

    let excedeu = false;
    for (let i = 0; i < 70 && !excedeu; i += 1) {
      const resposta = await app.inject({
        method: 'GET',
        url: '/v1/products?limit=1',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      excedeu = resposta.statusCode === 429;
    }

    expect(excedeu).toBe(true);
  });
});

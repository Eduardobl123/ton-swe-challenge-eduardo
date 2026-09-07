import { Product, User } from '../../../src/domain/entities';
import { Email, Money } from '../../../src/domain/value-objects';
import { buildApp } from '../../../src/infrastructure/http/app';
import { loadConfig } from '../../../src/infrastructure/config/env';
import { buildContainer } from '../../../src/main/container';
import { RecordingLogger } from '../../support/fakes';
import { createTestTable, type TestTable } from '../../integration/support';
import { assertMatchesContract } from './openapi-contract';
import type { Container } from '../../../src/main/container';
import type { FastifyInstance, InjectOptions } from 'fastify';

export const SENHA = 'Desafio@Ton2026';

export interface Chamada {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  readonly body: string;
  json<T = unknown>(): T;
}

export interface Ambiente {
  readonly app: FastifyInstance;
  readonly container: Container;
  readonly logger: RecordingLogger;
  readonly rotasChamadas: ReadonlySet<string>;
  /** Executa a requisição e recusa qualquer resposta fora do contrato publicado. */
  chamar(method: string, url: string, options?: InjectOptions): Promise<Chamada>;
  criarUsuario(email: string, senha?: string): Promise<string>;
  /** Grava o usuário com o bloqueio já vencido, sem depender de esperar no relógio. */
  expirarBloqueio(email: string): Promise<void>;
  encerrar(): Promise<void>;
}

/**
 * Sobe o sistema montado, contra o DynamoDB de verdade.
 *
 * Os testes unitários provam cada peça isolada e os de integração provam cada
 * consulta. O que só aparece aqui é a jornada: token assinado de verdade
 * atravessando o middleware de autenticação, cursor cifrado indo e voltando pelo
 * índice, contador de cota compartilhado entre requisições, bloqueio de conta
 * sobrevivendo entre chamadas.
 *
 * Cada arquivo recebe a própria tabela. Compartilhar uma faria a cota e o
 * bloqueio de um teste chegarem ao outro, e é justamente esse estado
 * compartilhado que está sob prova.
 */
export async function subirAmbiente(
  prefixo: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Ambiente> {
  const table: TestTable = await createTestTable(prefixo);
  const logger = new RecordingLogger();
  const container = buildContainer(
    loadConfig({
      JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
      TABLE_NAME: table.tableName,
      PERSISTENCE: 'dynamodb',
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
      SWAGGER_ENABLED: 'false',
      ...env,
    }),
    logger,
  );

  const app = await buildApp(container);
  const rotasChamadas = new Set<string>();

  return {
    app,
    container,
    logger,
    rotasChamadas,

    async chamar(method, url, options = {}) {
      const resposta = await app.inject({ method: method as never, url, ...options });
      const caminho = url.split('?')[0] ?? url;

      rotasChamadas.add(`${method.toUpperCase()} ${caminho}`);
      assertMatchesContract(method, caminho, {
        statusCode: resposta.statusCode,
        body: resposta.body,
        headers: resposta.headers,
      });

      return {
        statusCode: resposta.statusCode,
        headers: resposta.headers,
        body: resposta.body,
        json: <T>() => JSON.parse(resposta.body) as T,
      };
    },

    async criarUsuario(email, senha = SENHA) {
      const { users, passwordHasher, clock, idGenerator } = container.seeding;
      const id = idGenerator.next();

      await users.save(
        User.create({
          id,
          email: Email.create(email),
          passwordHash: await passwordHasher.hash(senha),
          failedLoginAttempts: 0,
          lockedUntil: undefined,
          createdAt: clock.now(),
          version: 0,
        }),
      );

      return id;
    },

    async expirarBloqueio(email) {
      const { users, clock } = container.seeding;
      const usuario = await users.findByEmail(Email.create(email));

      if (usuario === null || usuario === undefined) {
        throw new Error(`Usuário ${email} não existe.`);
      }

      // Reescrever o registro com o bloqueio no passado prova o mesmo que
      // adiantar o relógio, e sem esperar 30 segundos dentro da suíte.
      await users.save(
        User.create({
          ...usuario.toProps(),
          lockedUntil: new Date(clock.now().getTime() - 1_000),
        }),
      );
    },

    async encerrar() {
      await app.close();
      await table.drop();
    },
  };
}

/** Semeia produtos com data crescente, para a paginação ter ordem estável. */
export async function semearProdutos(container: Container, quantidade: number): Promise<void> {
  const base = container.seeding.clock.now().getTime();

  for (let i = 1; i <= quantidade; i += 1) {
    await container.seeding.products.add(
      Product.create({
        id: `p-${String(i).padStart(3, '0')}`,
        sku: `TON-${String(i).padStart(3, '0')}`,
        name: `Produto ${String(i)}`,
        description: `Item ${String(i)} do catálogo de teste`,
        price: Money.fromCents(1_000 + i),
        active: true,
        createdAt: new Date(base - (quantidade - i) * 60_000),
      }),
    );
  }
}

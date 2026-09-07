import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { readFileSync } from 'node:fs';
import { createClients } from '../../src/infrastructure/persistence/dynamodb';
import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import type { DynamoDbClients } from '../../src/infrastructure/persistence/dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const REGION = 'us-east-1';

/**
 * O DynamoDB Local exige credenciais e ignora o valor delas.
 *
 * São definidas aqui, e não dentro da fábrica de clientes, porque resolver
 * credencial é responsabilidade do SDK: na AWS ele usa a role da função, e
 * embutir um caminho alternativo no código de produção só para atender o
 * ambiente local abriria espaço para credencial fixa chegar onde não deve.
 */
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';

const schema = JSON.parse(readFileSync('infra/table-schema.json', 'utf8')) as Omit<
  CreateTableCommandInput,
  'TableName'
>;

export interface TestTable {
  readonly clients: DynamoDbClients;
  readonly tableName: string;
  drop(): Promise<void>;
}

/**
 * Cria uma tabela isolada para o conjunto de testes que a pede.
 *
 * Cada arquivo recebe a sua, com nome próprio. Compartilhar uma tabela faria os
 * testes dependerem da ordem de execução e da limpeza uns dos outros — e o que
 * está sob prova aqui é justamente comportamento sob escrita concorrente.
 *
 * O esquema vem do mesmo arquivo que o Terraform usa: se ele divergir, estes
 * testes deixam de dizer algo sobre produção.
 */
export async function createTestTable(prefix: string): Promise<TestTable> {
  const tableName = `test-${prefix}-${randomUUID().slice(0, 8)}`;
  const admin = new DynamoDBClient({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  await admin.send(new CreateTableCommand({ ...schema, TableName: tableName }));

  return {
    clients: createClients({ region: REGION, endpoint: ENDPOINT }),
    tableName,
    drop: () => admin.send(new DeleteTableCommand({ TableName: tableName })).then(() => undefined),
  };
}

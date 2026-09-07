import { readFile } from 'node:fs/promises';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Cria a tabela local a partir do mesmo esquema que o Terraform usa.
 *
 * O arquivo é único de propósito. Duas definições do mesmo esquema divergem —
 * alguém acrescenta um índice em um lado, os testes continuam passando contra
 * o outro, e a diferença só aparece em produção.
 *
 * Não roda contra a AWS: lá a tabela é criada pelo Terraform (issue #10).
 */
const TABLE_NAME = process.env.TABLE_NAME ?? 'ton-challenge-local';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function exists(): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (await exists()) {
    console.log(`Tabela ${TABLE_NAME} já existe.`);
    return;
  }

  const schema = JSON.parse(await readFile('infra/table-schema.json', 'utf8')) as Omit<
    CreateTableCommandInput,
    'TableName'
  >;

  await client.send(new CreateTableCommand({ ...schema, TableName: TABLE_NAME }));
  console.log(`Tabela ${TABLE_NAME} criada em ${ENDPOINT}.`);
}

await main();

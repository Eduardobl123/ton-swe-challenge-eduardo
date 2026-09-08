import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoDbUserRepository } from '../../../../src/infrastructure/persistence/dynamodb';
import { User } from '../../../../src/domain/entities';
import { ConcurrencyError } from '../../../../src/domain/errors';
import { Email, LockoutPolicy, PasswordHash } from '../../../../src/domain/value-objects';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const AGORA = new Date('2026-09-06T12:00:00.000Z');
const TABELA = 'tabela-de-teste';

const policy = LockoutPolicy.create({
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 900_000,
});

const usuario = (): User =>
  User.create({
    id: 'user-1',
    email: Email.create('maria@ton.com.br'),
    passwordHash: PasswordHash.create('$argon2id$hash'),
    failedLoginAttempts: 4,
    lockedUntil: undefined,
    createdAt: AGORA,
    version: 3,
  });

/** Item cru, no formato em que o serviço devolve dentro da exceção. */
const itemBruto = (lockedUntil: string) => ({
  pk: { S: 'USER#user-1' },
  sk: { S: 'USER#user-1' },
  gsi1pk: { S: 'EMAIL#maria@ton.com.br' },
  gsi1sk: { S: 'EMAIL#maria@ton.com.br' },
  entity: { S: 'User' },
  id: { S: 'user-1' },
  email: { S: 'maria@ton.com.br' },
  passwordHash: { S: '$argon2id$hash' },
  failedLoginAttempts: { N: '6' },
  lockedUntil: { S: lockedUntil },
  createdAt: { S: AGORA.toISOString() },
  version: { N: '9' },
});

/** Item já desempacotado, como o `DocumentClient` entrega no caminho de sucesso. */
const itemDocumento = (failedLoginAttempts: number, lockedUntil?: string) => ({
  pk: 'USER#user-1',
  sk: 'USER#user-1',
  gsi1pk: 'EMAIL#maria@ton.com.br',
  gsi1sk: 'EMAIL#maria@ton.com.br',
  entity: 'User',
  id: 'user-1',
  email: 'maria@ton.com.br',
  passwordHash: '$argon2id$hash',
  failedLoginAttempts,
  ...(lockedUntil === undefined ? {} : { lockedUntil }),
  createdAt: AGORA.toISOString(),
  version: 9,
});

const condicaoFalhou = (item?: Record<string, AttributeValue>): ConditionalCheckFailedException =>
  new ConditionalCheckFailedException({
    $metadata: {},
    message: 'The conditional request failed',
    ...(item === undefined ? {} : { Item: item }),
  });

interface Chamada {
  readonly ConditionExpression?: string;
  readonly ExpressionAttributeValues?: Record<string, unknown>;
  readonly UpdateExpression?: string;
}

/**
 * Cliente falso que responde a cada `send` na ordem informada.
 *
 * O que interessa aqui é a segunda escrita — a que aplica o bloqueio —, e ela
 * só é alcançada depois que a primeira devolve um contador que cruza o limiar.
 * Encenar as duas respostas é mais direto do que subir o banco para provar o
 * tratamento de uma exceção.
 */
const clienteFalso = (
  respostas: readonly (object | Error)[],
): { client: DynamoDBDocumentClient; chamadas: Chamada[] } => {
  const chamadas: Chamada[] = [];
  let i = 0;

  const client = {
    send: (command: { input: Chamada }) => {
      chamadas.push(command.input);
      const resposta = respostas[i];
      i += 1;

      return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta);
    },
  } as unknown as DynamoDBDocumentClient;

  return { client, chamadas };
};

describe('DynamoDbUserRepository.registerFailedLogin', () => {
  it('a escrita do bloqueio exige que o instante avance', async () => {
    // A condição é a defesa contra encurtamento por escrita concorrente: sem
    // ela, a tentativa que calculou o bloqueio menor pode gravar por último.
    const { client, chamadas } = clienteFalso([
      { Attributes: itemDocumento(5) },
      { Attributes: itemDocumento(5, new Date(AGORA.getTime() + 30_000).toISOString()) },
    ]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    await repo.registerFailedLogin(usuario(), AGORA, policy);

    expect(chamadas[1]?.ConditionExpression).toBe(
      'attribute_exists(pk) AND (attribute_not_exists(lockedUntil) OR lockedUntil < :until)',
    );
    expect(chamadas[1]?.ExpressionAttributeValues?.[':until']).toBe(
      new Date(AGORA.getTime() + 30_000).toISOString(),
    );
  });

  it('condição recusada com item devolve o bloqueio já gravado, sem erro', async () => {
    // Outra requisição chegou antes com um bloqueio igual ou mais longo. É o
    // resultado desejado, não uma falha — quem chama não pode ver exceção.
    const maisLongo = new Date(AGORA.getTime() + 60_000).toISOString();
    const { client } = clienteFalso([
      { Attributes: itemDocumento(5) },
      condicaoFalhou(itemBruto(maisLongo)),
    ]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    const resultado = await repo.registerFailedLogin(usuario(), AGORA, policy);

    expect(resultado.lockedUntilIfLocked(AGORA)?.toISOString()).toBe(maisLongo);
  });

  it('o retorno reflete o estado gravado, não o que esta requisição calculou', async () => {
    // A reconstrução otimista mentiria justamente no caso que a condição existe
    // para tratar: ela devolveria 30s enquanto o banco guarda 60s.
    const maisLongo = new Date(AGORA.getTime() + 60_000).toISOString();
    const { client } = clienteFalso([
      { Attributes: itemDocumento(5) },
      condicaoFalhou(itemBruto(maisLongo)),
    ]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    const resultado = await repo.registerFailedLogin(usuario(), AGORA, policy);

    expect(resultado.failedLoginAttempts).toBe(6);
    expect(resultado.version).toBe(9);
  });

  it('condição recusada sem item significa usuário removido, e vira ConcurrencyError', async () => {
    // Sem `Item` na exceção, o que falhou foi `attribute_exists(pk)`. É a única
    // falha real das duas escritas, e precisa continuar chegando a quem chama.
    const { client } = clienteFalso([{ Attributes: itemDocumento(5) }, condicaoFalhou()]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    await expect(repo.registerFailedLogin(usuario(), AGORA, policy)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it('erro que não é de condição continua subindo', async () => {
    const { client } = clienteFalso([{ Attributes: itemDocumento(5) }, new Error('falha de rede')]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    await expect(repo.registerFailedLogin(usuario(), AGORA, policy)).rejects.toThrow(
      'falha de rede',
    );
  });

  it('abaixo do limite não há segunda escrita', async () => {
    const { client, chamadas } = clienteFalso([{ Attributes: itemDocumento(3) }]);
    const repo = new DynamoDbUserRepository(client, TABELA);

    const resultado = await repo.registerFailedLogin(usuario(), AGORA, policy);

    expect(chamadas).toHaveLength(1);
    expect(resultado.isLocked(AGORA)).toBe(false);
  });
});

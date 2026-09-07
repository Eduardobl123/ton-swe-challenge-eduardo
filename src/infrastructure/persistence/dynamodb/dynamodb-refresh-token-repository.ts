import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConcurrencyError } from '../../../domain/errors';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { RefreshToken } from '../../../domain/entities';
import type { RefreshTokenRepository } from '../../../domain/ports';
import { GSI1, keys } from './table';
import { toRefreshToken, toRefreshTokenItem, type RefreshTokenItem } from './refresh-token.mapper';

export class DynamoDbRefreshTokenRepository implements RefreshTokenRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  public async save(token: RefreshToken): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: toRefreshTokenItem(token) }),
    );
  }

  /** Acesso direto por chave: o hash apresentado **é** a chave primária. */
  public async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: keys.refreshToken(tokenHash) }),
    );

    return Item === undefined ? null : toRefreshToken(Item as RefreshTokenItem);
  }

  /**
   * Marca o token como rotacionado e grava o sucessor, tudo ou nada.
   *
   * A condição é o coração da detecção de reuso: só passa quem encontrar o
   * token ainda intacto. Duas renovações simultâneas com a mesma credencial
   * resultam em exatamente uma vitória — se as duas passassem, a cópia roubada
   * seria tão válida quanto a legítima e a detecção nunca dispararia.
   *
   * A transação garante que nunca exista um sucessor sem o antecessor marcado,
   * estado em que o token antigo continuaria funcionando.
   *
   * @throws {ConcurrencyError} quando o token já havia sido rotacionado ou
   *   revogado.
   */
  public async rotate(current: RefreshToken, next: RefreshToken): Promise<void> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: keys.refreshToken(current.tokenHash),
                UpdateExpression: 'SET replacedByTokenId = :next',
                ConditionExpression:
                  'attribute_exists(pk) AND attribute_not_exists(replacedByTokenId) AND attribute_not_exists(revokedAt)',
                ExpressionAttributeValues: { ':next': next.id },
              },
            },
            {
              Put: { TableName: this.tableName, Item: toRefreshTokenItem(next) },
            },
          ],
        }),
      );
    } catch (error) {
      if (isConditionFailure(error)) {
        throw new ConcurrencyError('RefreshToken', current.id);
      }

      throw error;
    }
  }

  /**
   * Revoga todos os tokens da família.
   *
   * A busca é pelo índice da família e a escrita é item a item. Uma transação
   * cobriria no máximo cem itens e falharia inteira se um deles conflitasse —
   * aqui o que importa é que todos acabem revogados, e revogar duas vezes é
   * inofensivo.
   */
  public async revokeFamily(familyId: string, now: Date): Promise<void> {
    let startKey: Record<string, unknown> | undefined;

    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: GSI1,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'gsi1pk' },
          ExpressionAttributeValues: { ':pk': `RTFAM#${familyId}` },
          ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
        }),
      );

      for (const item of (page.Items ?? []) as RefreshTokenItem[]) {
        await this.client
          .send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: keys.refreshToken(item.tokenHash),
              UpdateExpression: 'SET revokedAt = :now',
              // Preserva a marcação original: saber quando a sessão caiu é o que
              // permite reconstruir a linha do tempo de um incidente.
              ConditionExpression: 'attribute_not_exists(revokedAt)',
              ExpressionAttributeValues: { ':now': now.toISOString() },
            }),
          )
          .catch((error: unknown) => {
            if (!isConditionFailure(error)) {
              throw error;
            }
          });
      }

      startKey = page.LastEvaluatedKey;
    } while (startKey !== undefined);
  }
}

/**
 * A falha de condição chega de duas formas: direta em escrita simples, e
 * embutida nas razões de cancelamento quando vem de uma transação.
 */
function isConditionFailure(error: unknown): boolean {
  if (error instanceof ConditionalCheckFailedException) {
    return true;
  }

  const cancellation = error as { name?: string; CancellationReasons?: { Code?: string }[] };

  return (
    cancellation.name === 'TransactionCanceledException' &&
    (cancellation.CancellationReasons ?? []).some(
      (reason) => reason.Code === 'ConditionalCheckFailed',
    )
  );
}

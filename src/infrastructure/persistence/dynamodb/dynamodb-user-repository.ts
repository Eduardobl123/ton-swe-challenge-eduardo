import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConcurrencyError } from '../../../domain/errors';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { User } from '../../../domain/entities';
import type { Email, LockoutPolicy } from '../../../domain/value-objects';
import type { UserRepository } from '../../../domain/ports';
import { GSI1, keys } from './table';
import { toUser, toUserItem, type UserItem } from './user.mapper';

export class DynamoDbUserRepository implements UserRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /**
   * Busca pelo índice, nunca por varredura.
   *
   * Uma varredura leria a tabela inteira a cada tentativa de login, e o custo
   * cresceria com a base de usuários — exatamente o oposto do que se quer no
   * caminho mais quente da aplicação.
   */
  public async findByEmail(email: Email): Promise<User | null> {
    const { Items } = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1,
        KeyConditionExpression: '#pk = :pk AND #sk = :sk',
        ExpressionAttributeNames: { '#pk': 'gsi1pk', '#sk': 'gsi1sk' },
        ExpressionAttributeValues: {
          ':pk': keys.userByEmail(email.value).gsi1pk,
          ':sk': keys.userByEmail(email.value).gsi1sk,
        },
        Limit: 1,
      }),
    );

    const item = Items?.[0] as UserItem | undefined;

    return item === undefined ? null : toUser(item);
  }

  /**
   * Contabiliza a falha com um incremento atômico.
   *
   * O contador é somado pelo próprio banco, e não lido e regravado pela
   * aplicação. Sem isso, tentativas simultâneas leriam o mesmo total e
   * gravariam por cima umas das outras: cem em paralelo contariam como uma, e
   * o bloqueio deixaria de valer contra ataque automatizado.
   *
   * O bloqueio é aplicado numa segunda escrita, condicionada ao total que a
   * primeira devolveu. Só acontece a partir da tentativa que atinge o limite,
   * então o caminho comum continua sendo uma escrita só.
   */
  public async registerFailedLogin(user: User, now: Date, policy: LockoutPolicy): Promise<User> {
    const { Attributes } = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: keys.user(user.id),
        UpdateExpression: 'ADD failedLoginAttempts :one, version :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'ALL_NEW',
      }),
    );

    const updated = toUser(Attributes as UserItem);
    const lockDurationMs = policy.lockDurationMs(updated.failedLoginAttempts);

    if (lockDurationMs === 0) {
      return updated;
    }

    const lockedUntil = new Date(now.getTime() + lockDurationMs);
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: keys.user(user.id),
        UpdateExpression: 'SET lockedUntil = :until',
        ExpressionAttributeValues: { ':until': lockedUntil.toISOString() },
      }),
    );

    return toUser({ ...toUserItem(updated), lockedUntil: lockedUntil.toISOString() });
  }

  /**
   * @throws {ConcurrencyError} quando outra escrita alterou o registro desde a
   *   leitura. A condição sobre a versão é o que impede que duas atualizações
   *   simultâneas se sobrescrevam em silêncio.
   */
  public async save(user: User): Promise<void> {
    const props = user.toProps();
    const item = toUserItem(user);

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...item, version: props.version + 1 },
          ConditionExpression: 'attribute_not_exists(pk) OR version = :expected',
          ExpressionAttributeValues: { ':expected': props.version },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConcurrencyError('User', props.id);
      }

      throw error;
    }
  }

  /** Usado apenas pela carga inicial, que precisa saber se já gravou antes. */
  public async findById(id: string): Promise<User | null> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: keys.user(id) }),
    );

    return Item === undefined ? null : toUser(Item as UserItem);
  }
}

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
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
   *
   * Separar contagem de bloqueio deixa as duas escritas concorrentes entre si, e
   * o DynamoDB não ordena escritas independentes. Por isso a segunda é
   * condicionada também ao valor atual de `lockedUntil`: o bloqueio só avança.
   *
   * @throws {ConcurrencyError} quando o usuário deixa de existir no meio do
   *   processo — a única falha real das duas escritas.
   */
  public async registerFailedLogin(user: User, now: Date, policy: LockoutPolicy): Promise<User> {
    const { Attributes } = await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: keys.user(user.id),
          UpdateExpression: 'ADD failedLoginAttempts :one, version :one',
          // Sem esta condição, o `ADD` **cria** o item quando ele não existe: o
          // banco ficaria com um registro parcial permanente, só com chave e
          // contador, e a reconstrução da entidade quebraria com erro de tipo em
          // vez de resposta prevista.
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'ALL_NEW',
        }),
      )
      .catch((error: unknown) => {
        if (error instanceof ConditionalCheckFailedException) {
          // O usuário sumiu entre a leitura e esta escrita. Para quem chama é
          // indistinguível de qualquer outra corrida perdida.
          throw new ConcurrencyError('User', user.id);
        }

        throw error;
      });

    const updated = toUser(Attributes as UserItem);
    const lockDurationMs = policy.lockDurationMs(updated.failedLoginAttempts);

    if (lockDurationMs === 0) {
      return updated;
    }

    const lockedUntil = new Date(now.getTime() + lockDurationMs);
    const { Attributes: locked } = await this.client
      .send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: keys.user(user.id),
          UpdateExpression: 'SET lockedUntil = :until ADD version :one',
          // Duas condições em uma. `attribute_exists(pk)` é a de sempre: o
          // usuário sumiu entre as escritas. A segunda torna o bloqueio
          // monotônico — ele só avança, nunca retrocede.
          //
          // Sem ela, duas tentativas que cruzam o limiar gravam sem ordem: a que
          // contou 5 falhas pede 30s, a que contou 6 pede 60s, e se a de 30s
          // chegar por último ela encurta um bloqueio já aplicado. Quem ataca em
          // paralelo consegue assim manter a punição no mínimo.
          //
          // A comparação é lexicográfica, e vale porque `lockedUntil` é gravado
          // com `toISOString()`: largura fixa, sempre em UTC, então a ordem
          // alfabética coincide com a cronológica. Trocar esse formato quebra a
          // condição em silêncio — ver `toUserItem` em `user.mapper.ts`.
          ConditionExpression:
            'attribute_exists(pk) AND (attribute_not_exists(lockedUntil) OR lockedUntil < :until)',
          ExpressionAttributeValues: { ':until': lockedUntil.toISOString(), ':one': 1 },
          ReturnValues: 'ALL_NEW',
          // Distingue as duas causas de falha da condição acima: com o item em
          // mãos, a causa foi a monotonicidade; sem ele, o usuário não existe
          // mais.
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      )
      .catch((error: unknown) => {
        if (!(error instanceof ConditionalCheckFailedException)) {
          throw error;
        }

        if (error.Item === undefined) {
          throw new ConcurrencyError('User', user.id);
        }

        // Outra requisição já gravou um bloqueio igual ou mais longo. É o
        // resultado desejado, não uma falha: nada a corrigir, e o estado a
        // devolver é o que ficou gravado.
        //
        // O item vem no formato bruto do serviço. O `DocumentClient` só
        // desempacota o retorno de sucesso — seu middleware não alcança o corpo
        // da exceção —, então a conversão é feita aqui.
        return { Attributes: unmarshall(error.Item) };
      });

    return toUser(locked as UserItem);
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

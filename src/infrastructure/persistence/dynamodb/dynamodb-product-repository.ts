import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvalidCursorError } from '../../../domain/errors';
import { PageCursor } from '../../../domain/value-objects';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Product } from '../../../domain/entities';
import type {
  ListActiveProductsQuery,
  ProductPage,
  ProductRepository,
} from '../../../domain/ports';
import type { CursorCodec } from '../cursor-codec';
import { GSI1 } from './table';
import { toProduct, toProductItem, type ProductItem } from './product.mapper';

/** Chave de continuação devolvida pelo DynamoDB, cifrada dentro do cursor. */
interface ContinuationKey {
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
}

export class DynamoDbProductRepository implements ProductRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly cursors: CursorCodec,
  ) {}

  /**
   * Lê uma página do índice, do mais recente para o mais antigo.
   *
   * O custo é proporcional ao tamanho da página e não à profundidade dela, que
   * é a razão de existir o cursor em vez de deslocamento numérico (ADR 0004).
   */
  public async listActive({ limit, cursor }: ListActiveProductsQuery): Promise<ProductPage> {
    const { Items, LastEvaluatedKey } = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'gsi1pk' },
        ExpressionAttributeValues: { ':pk': 'PRODUCT#ACTIVE' },
        // Mais recentes primeiro, que é a ordem em que um catálogo é consumido.
        ScanIndexForward: false,
        Limit: limit,
        ...(cursor === undefined ? {} : { ExclusiveStartKey: this.decode(cursor) }),
      }),
    );

    const items = (Items ?? []).map((item) => toProduct(item as ProductItem));

    return {
      items,
      nextCursor:
        LastEvaluatedKey === undefined
          ? undefined
          : PageCursor.create(this.cursors.encode(JSON.stringify(LastEvaluatedKey))),
    };
  }

  /** Usado pela carga inicial. Idempotente por condição na chave. */
  public async add(product: Product): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: toProductItem(product) }),
    );
  }

  /**
   * @throws {InvalidCursorError} para cursor adulterado, cifrado com outro
   *   segredo ou que não contenha uma chave de continuação desta tabela.
   */
  private decode(cursor: PageCursor): ContinuationKey {
    const decoded: unknown = JSON.parse(this.cursors.decode(cursor.value));

    if (!isContinuationKey(decoded)) {
      throw new InvalidCursorError();
    }

    return decoded;
  }
}

/**
 * O conteúdo já passou pela cifra, então adulteração está descartada. A
 * conferência de forma cobre o caso de uma versão anterior ter emitido cursor
 * com outro formato, o que acontece em implantação gradual.
 */
function isContinuationKey(value: unknown): value is ContinuationKey {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { pk, sk, gsi1pk, gsi1sk } = value as Partial<ContinuationKey>;

  return (
    typeof pk === 'string' &&
    typeof sk === 'string' &&
    typeof gsi1pk === 'string' &&
    typeof gsi1sk === 'string'
  );
}

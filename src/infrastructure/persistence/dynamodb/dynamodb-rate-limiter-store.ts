import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { RateLimitWindows, RateLimiterStore } from '../../../domain/ports';
import { keys, toTtl } from './table';

/**
 * Sobrevida do contador depois que a janela fecha.
 *
 * O item precisa continuar legível enquanto a janela seguinte o consulta como
 * "anterior". O TTL do DynamoDB remove com atraso de até 48 horas, então esta
 * folga é generosa de propósito: expurgo tardio custa alguns bytes, expurgo
 * cedo demais apagaria a contagem que ainda pondera o cálculo.
 */
const RETENTION_SECONDS = 300;

/** Forma do item de contador, para não acessar o resultado por índice solto. */
interface CounterItem {
  readonly hits?: number;
}

export class DynamoDbRateLimiterStore implements RateLimiterStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /**
   * Contabiliza a requisição e devolve as duas janelas relevantes.
   *
   * O incremento é uma escrita atômica: o banco soma, a aplicação não lê para
   * regravar. Sob concorrência — que é exatamente quando o limite precisa
   * funcionar — ler e escrever perderia contagem.
   *
   * A leitura da janela anterior é uma segunda operação, e é o preço da janela
   * deslizante. Sem ela, o que se tem é janela fixa, e quem envia a cota inteira
   * na virada do minuto passa com o dobro (ADR 0005).
   */
  public async hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindows> {
    // Alinhada ao tamanho da janela, e não ao instante da primeira requisição:
    // é o que faz todas as instâncias concordarem sobre onde uma janela começa.
    const windowStartedAt = Math.floor(now.getTime() / windowMs) * windowMs;
    const previousStartedAt = windowStartedAt - windowMs;
    const expiresAt = new Date(windowStartedAt + windowMs + RETENTION_SECONDS * 1_000);

    const [incremented, previous] = await Promise.all([
      this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: keys.rateLimit(key, windowStartedAt),
          UpdateExpression: 'ADD hits :one SET #ttl = if_not_exists(#ttl, :ttl)',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': toTtl(expiresAt) },
          ReturnValues: 'UPDATED_NEW',
        }),
      ),
      this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: keys.rateLimit(key, previousStartedAt),
          ProjectionExpression: 'hits',
        }),
      ),
    ]);

    return {
      current: Number((incremented.Attributes as CounterItem | undefined)?.hits ?? 1),
      // Janela anterior sem tráfego não deixa item, e ausência conta como zero.
      previous: Number((previous.Item as CounterItem | undefined)?.hits ?? 0),
      windowStartedAt: new Date(windowStartedAt),
    };
  }
}

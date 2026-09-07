import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Logger } from '../../../domain/ports';
import type { ReadinessProbe } from '../../system/readiness-probe';

/**
 * Confirma que a tabela existe e responde.
 *
 * `DescribeTable` é a verificação mais barata possível: consulta metadados, não
 * lê item nenhum e não consome capacidade. Uma leitura de verdade custaria a
 * cada checagem, e o orquestrador chama isso o tempo todo.
 *
 * A permissão correspondente precisa constar da política de IAM da função. Foi
 * justamente isso que a revisão do plano identificou como faltando — sem ela, a
 * sonda falharia em produção e só lá.
 */
export class DynamoDbReadinessProbe implements ReadinessProbe {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  /** Nunca lança: dependência fora do ar é resposta, não exceção. */
  public async check(): Promise<boolean> {
    try {
      const { Table } = await this.client.send(
        new DescribeTableCommand({ TableName: this.tableName }),
      );

      return Table?.TableStatus === 'ACTIVE';
    } catch (error) {
      this.logger.error('readiness.dynamodb_unavailable', {
        table: this.tableName,
        reason: error instanceof Error ? error.message : 'desconhecido',
      });

      return false;
    }
  }
}

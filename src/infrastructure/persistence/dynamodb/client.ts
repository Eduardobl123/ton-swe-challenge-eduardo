import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface DynamoDbClientOptions {
  readonly region: string;
  /** Definido apenas em desenvolvimento, apontando para o DynamoDB Local. */
  readonly endpoint: string | undefined;
}

/**
 * Cliente do DynamoDB com os ajustes que importam em ambiente sem servidor.
 *
 * Os tempos limite são curtos de propósito. Uma requisição que espera trinta
 * segundos por uma leitura já falhou do ponto de vista de quem chamou; o que
 * ela ainda consegue fazer é segurar a invocação do Lambda até o timeout dela
 * também estourar, transformando uma lentidão do banco em indisponibilidade.
 *
 * As tentativas ficam em três, porque erros de rede pontuais são comuns e
 * baratos de repetir. O SDK aplica espera exponencial entre elas.
 */
export interface DynamoDbClients {
  /**
   * Cliente de documento, usado pelos repositórios: converte tipos do
   * JavaScript sem o formato anotado do DynamoDB.
   */
  readonly documents: DynamoDBDocumentClient;
  /**
   * Cliente de baixo nível, necessário para operações que não lidam com itens —
   * `DescribeTable`, por exemplo. Devolvido explicitamente em vez de extraído do
   * outro por dentro, que exigiria asserção de tipo.
   */
  readonly base: DynamoDBClient;
}

export function createClients(options: DynamoDbClientOptions): DynamoDbClients {
  const client = new DynamoDBClient({
    region: options.region,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    maxAttempts: 3,
    requestHandler: { requestTimeout: 3_000, connectionTimeout: 1_000 },
  });

  const documents = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      // Campo ausente é mais barato de consultar e ocupa menos que um nulo, e
      // os mapeadores já omitem o que não se aplica.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });

  return { documents, base: client };
}

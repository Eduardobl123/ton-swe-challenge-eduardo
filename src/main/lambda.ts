import awsLambdaFastify from '@fastify/aws-lambda';
import * as SentryLambda from '@sentry/aws-serverless';
import { buildApp } from '../infrastructure/http/app';
import { loadConfig } from '../infrastructure/config/env';
import { resolveSecrets } from '../infrastructure/config/secrets';
import { PinoLogger } from '../infrastructure/observability';
import { buildContainer } from './container';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';

/**
 * Entrypoint do AWS Lambda.
 *
 * ## O que acontece fora do handler, e por quê
 *
 * A configuração, o container e a aplicação são montados no carregamento do
 * módulo, não a cada invocação. O Lambda reaproveita a instância entre chamadas,
 * então esse trabalho — que inclui ler os segredos e criar os clientes do SDK —
 * acontece uma vez por instância em vez de uma vez por requisição. Fazê-lo
 * dentro do handler somaria dezenas de milissegundos a **toda** resposta, e não
 * apenas à primeira.
 *
 * É também por isso que a configuração inválida derruba a instância no
 * carregamento: falhar aqui aparece no deploy, enquanto falhar na primeira
 * requisição vira um 500 intermitente difícil de rastrear.
 *
 * ## O que este arquivo não faz
 *
 * Não conhece rota, caso de uso nem regra. Ele só embrulha a aplicação, que
 * continua sem saber onde roda — é o que permite exercitar toda a superfície
 * com `app.inject`, sem abrir porta nem simular evento do API Gateway.
 */
// Os segredos vêm por referência ao parâmetro, e são resolvidos aqui, uma vez
// por instância. Buscar a cada invocação colocaria a latência do SSM dentro do
// p99 de toda resposta.
await resolveSecrets({ region: process.env.AWS_REGION ?? 'us-east-1' });

const config = loadConfig();

const logger = new PinoLogger({
  level: config.log.level,
  environment: config.nodeEnv,
  version: config.version,
  // Nunca legível aqui: o CloudWatch lê o stdout, e código de cor viraria lixo
  // em toda linha coletada.
  pretty: false,
});

const container = buildContainer(config, logger);

if (config.observability.sentryDsn !== undefined) {
  // A inicialização específica para ambiente sem servidor é o que garante o
  // descarregamento dos eventos antes de a invocação terminar. Sem ela, o
  // processo congela com o relatório ainda na fila e o erro se perde
  // exatamente quando acontece.
  SentryLambda.init({
    dsn: config.observability.sentryDsn,
    environment: config.nodeEnv,
    release: config.version,
    tracesSampleRate: config.observability.sentryTracesSampleRate,
    sendDefaultPii: false,
  });
}

/**
 * O adaptador é criado uma vez, e não a cada invocação.
 *
 * Ele registra ganchos e prepara a instância do Fastify; refazer isso por
 * requisição jogaria fora a única vantagem de o Lambda reaproveitar a instância.
 */
const proxyPromise = buildApp(container).then((app) => awsLambdaFastify(app));

const proxy = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> => {
  const forward = await proxyPromise;

  return forward(event, context);
};

export const handler = SentryLambda.wrapHandler(proxy);

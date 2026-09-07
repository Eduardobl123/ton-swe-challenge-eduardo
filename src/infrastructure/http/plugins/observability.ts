import fp from 'fastify-plugin';
import type { FastifyPluginCallback } from 'fastify';
import type { Logger, MetricsRecorder } from '../../../domain/ports';

export interface ObservabilityOptions {
  readonly logger: Logger;
  readonly metrics: MetricsRecorder;
}

/**
 * Registro e medição de cada requisição.
 *
 * Uma linha por requisição, com o identificador de correlação, o resultado e a
 * duração. É o que permite responder "o que aconteceu com a requisição que o
 * cliente relatou" sem depender de o erro ter sido registrado em outro lugar.
 *
 * A rota entra como o **padrão** que o roteador casou, e não a URL recebida. A
 * URL traria o cursor de paginação e viraria cardinalidade infinita, tanto no
 * log quanto na métrica — e uma dimensão com cardinalidade infinita no
 * CloudWatch é uma série temporal por requisição.
 */
const plugin: FastifyPluginCallback<ObservabilityOptions> = (app, { logger, metrics }, done) => {
  app.addHook('onRequest', (request, _reply, next) => {
    request.startedAt = process.hrtime.bigint();
    next();
  });

  app.addHook('onResponse', (request, reply, next) => {
    const durationMs = Number(process.hrtime.bigint() - request.startedAt) / 1e6;
    const route = request.routeOptions.url ?? 'desconhecida';
    const { statusCode } = reply;

    logger.info('http.request', {
      requestId: request.requestId,
      method: request.method,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: request.authenticatedUser?.id,
      ipAddress: request.ip,
    });

    metrics.record('RequestDuration', durationMs, 'Milliseconds', { Route: route });

    if (statusCode === 429) {
      metrics.record('RateLimited', 1, 'Count', { Route: route });
    }

    if (statusCode >= 500) {
      metrics.record('ServerError', 1, 'Count', { Route: route });
    }

    // O resultado do login é derivado do status, e não de um contador dentro do
    // caso de uso. Ele já é exato para o que estas métricas medem, e evita
    // atravessar a porta de métricas por todas as camadas para contar duas
    // coisas.
    if (route === '/v1/auth/login') {
      metrics.record(statusCode === 200 ? 'LoginSuccess' : 'LoginFailure', 1, 'Count');
    }

    next();
  });

  done();
};

export const observabilityPlugin = fp(plugin, { name: 'observability' });

import fp from 'fastify-plugin';
import { RateLimitExceededError } from '../../../application/errors';
import type {
  RateLimitDecision,
  RateLimitRule,
  RateLimiter,
} from '../../../application/rate-limit';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitPluginOptions {
  readonly rateLimiter: RateLimiter;
}

/**
 * Aplicação da cota nas rotas.
 *
 * Os cabeçalhos são escritos **também quando a requisição passa**. Um cliente
 * bem construído desacelera ao ver o saldo baixar; se só descobrir o limite ao
 * receber 429, ele já bateu na parede. Os nomes seguem o rascunho da IETF para
 * campos de RateLimit.
 */
const plugin: FastifyPluginCallback<RateLimitPluginOptions> = (app, { rateLimiter }, done) => {
  app.decorate(
    'enforceRateLimit',
    (rule: RateLimitRule, subjectOf: (request: FastifyRequest) => string) =>
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const decision = await rateLimiter.check(rule, subjectOf(request));

        applyHeaders(reply, decision);

        if (!decision.allowed) {
          // Lançar, em vez de responder aqui, mantém o formato do corpo de erro
          // em um lugar só — o tratador central.
          throw new RateLimitExceededError(decision.resetAt, decision.limit);
        }
      },
  );

  done();
};

function applyHeaders(reply: FastifyReply, decision: RateLimitDecision): void {
  void reply.header('RateLimit-Limit', decision.limit);
  void reply.header('RateLimit-Remaining', decision.remaining);
  void reply.header(
    'RateLimit-Reset',
    Math.max(0, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000)),
  );

  if (!decision.allowed) {
    void reply.header('Retry-After', decision.retryAfterSeconds);
  }
}

export const rateLimitPlugin = fp(plugin, { name: 'rate-limit' });

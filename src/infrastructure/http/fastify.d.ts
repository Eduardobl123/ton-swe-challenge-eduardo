import type { RateLimitRule } from '../../application/rate-limit';
import type { AuthenticatedUser } from './plugins/auth';

/**
 * Propriedades que os plugins acrescentam à requisição.
 *
 * Declarar aqui é o que permite ao compilador cobrar `request.requestId` em vez
 * de deixar o acesso passar como `any` — o tipo do framework deixa de mentir
 * sobre o que existe em tempo de execução.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** Gancho `onRequest` que exige e valida o access token. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Fábrica de gancho `onRequest` que aplica uma política de limite. */
    enforceRateLimit: (
      rule: RateLimitRule,
      subjectOf: (request: FastifyRequest) => string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Correlação entre resposta, log e evento de erro. Sempre presente. */
    requestId: string;
    /** Preenchido apenas nas rotas que exigem autenticação. */
    authenticatedUser: AuthenticatedUser | undefined;
  }
}

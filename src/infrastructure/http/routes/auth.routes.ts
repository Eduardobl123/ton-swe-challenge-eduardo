import { z } from 'zod';
import { rateLimitSubject } from '../../../application/rate-limit';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RateLimitRule } from '../../../application/rate-limit';
import type { Container } from '../../../main/container';
import { authenticatedUserId } from '../plugins/auth';
import { problemResponses } from '../schemas/common.schemas';
import {
  loginBodySchema,
  loginResponseSchema,
  refreshBodySchema,
  sessionResponseSchema,
} from '../schemas/auth.schemas';

/**
 * Rotas de sessão.
 *
 * Login e renovação são limitados **por origem**, e não por usuário: nas duas
 * ainda não há identidade confirmada, e é exatamente ali que a força bruta
 * acontece. Cada uma tem cota própria, para que gastar o limite de uma não
 * derrube a outra.
 */
export const authRoutes =
  (container: Container): FastifyPluginAsyncZod =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async (app) => {
    const { useCases, policies } = container;
    const byIp = (
      rule: RateLimitRule,
    ): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
      app.enforceRateLimit(rule, (request) => rateLimitSubject.ip(request.ip));

    app.post(
      '/login',
      {
        onRequest: byIp(policies.rateLimit.login),
        schema: {
          tags: ['Autenticação'],
          summary: 'Autentica e abre uma sessão',
          description:
            'Devolve um access token de curta duração e um refresh token de uso único. ' +
            'Credencial inválida, conta inexistente e conta temporariamente bloqueada ' +
            'produzem a mesma resposta, de propósito.',
          body: loginBodySchema,
          response: { 200: loginResponseSchema, ...problemResponses },
        },
      },
      async (request) => {
        return useCases.authenticateUser.execute({
          email: request.body.email,
          password: request.body.password,
          ipAddress: request.ip,
        });
      },
    );

    app.post(
      '/refresh',
      {
        onRequest: byIp(policies.rateLimit.refresh),
        schema: {
          tags: ['Autenticação'],
          summary: 'Renova a sessão',
          description:
            'Rotaciona o refresh token: o apresentado deixa de valer e um novo par é emitido. ' +
            'Reapresentar um token já usado derruba a sessão inteira.',
          body: refreshBodySchema,
          response: { 200: sessionResponseSchema, ...problemResponses },
        },
      },
      async (request) => {
        return useCases.refreshSession.execute({
          refreshToken: request.body.refreshToken,
          ipAddress: request.ip,
        });
      },
    );

    app.post(
      '/logout',
      {
        onRequest: [app.authenticate, byIp(policies.rateLimit.refresh)],
        schema: {
          tags: ['Autenticação'],
          summary: 'Encerra a sessão',
          description:
            'Revoga a família do refresh token apresentado. O access token em circulação ' +
            'permanece válido até expirar, no máximo o tempo de `expiresIn`.',
          body: refreshBodySchema,
          // Encerrar sessão não devolve representação nenhuma. O schema `null`
          // é o que expressa isso para o serializador e para a documentação.
          response: { 204: z.null(), ...problemResponses },
        },
      },
      async (request, reply) => {
        await useCases.logout.execute({
          refreshToken: request.body.refreshToken,
          userId: authenticatedUserId(request),
          ipAddress: request.ip,
        });

        await reply.status(204).send(null);
      },
    );
  };

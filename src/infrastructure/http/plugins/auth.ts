import fp from 'fastify-plugin';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger, TokenSigner } from '../../../domain/ports';
import { problemDetails } from '../problem-details';

export interface AuthenticatedUser {
  readonly id: string;
}

export interface AuthPluginOptions {
  readonly tokenSigner: TokenSigner;
  readonly logger: Logger;
}

const BEARER = /^Bearer (.+)$/;

/**
 * Identificador do usuário autenticado.
 *
 * Só faz sentido depois do gancho de autenticação, que ou preenche o campo ou
 * responde 401 — e o Fastify não executa os ganchos seguintes quando um deles
 * responde. Lançar aqui é a forma de dizer que chamar isto em rota pública é
 * defeito de montagem, não situação a ser tratada.
 */
export function authenticatedUserId(request: FastifyRequest): string {
  const user = request.authenticatedUser;

  if (user === undefined) {
    throw new Error('Rota sem o gancho de autenticação registrado antes do limite por usuário.');
  }

  return user.id;
}

/**
 * Verificação do access token.
 *
 * O plugin **decora** a instância com um gancho reutilizável em vez de aplicar
 * a verificação globalmente. Autenticação global obriga a lembrar de excluir
 * cada rota pública, e esquecer de excluir é um erro barulhento — a rota para
 * de funcionar. Já o oposto, esquecer de proteger, é silencioso: a rota
 * funciona e fica aberta. A escolha é pelo erro que aparece.
 */
const plugin: FastifyPluginCallback<AuthPluginOptions> = (app, { tokenSigner, logger }, done) => {
  app.decorateRequest('authenticatedUser', undefined);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const match = header === undefined ? null : BEARER.exec(header);

    if (match?.[1] === undefined) {
      await reply.status(401).send(
        problemDetails({
          code: 'UNAUTHENTICATED',
          instance: request.url,
          requestId: request.requestId,
        }),
      );
      return;
    }

    try {
      const claims = await tokenSigner.verify(match[1]);
      request.authenticatedUser = { id: claims.sub };
    } catch (error) {
      // Distinguir expirado de inválido não vaza nada: o cliente já tem o
      // token e pode lê-lo sozinho. Saber que expirou é o que lhe diz para
      // renovar em vez de mandar o usuário autenticar de novo.
      const expired = error instanceof Error && /exp|expired/i.test(error.message);

      logger.info('http.token_rejected', {
        requestId: request.requestId,
        route: request.url,
        reason: expired ? 'expired' : 'invalid',
      });

      await reply.status(401).send(
        problemDetails({
          code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
          instance: request.url,
          requestId: request.requestId,
        }),
      );
    }
  });

  done();
};

export const authPlugin = fp(plugin, { name: 'auth' });

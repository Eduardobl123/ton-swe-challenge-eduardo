import fp from 'fastify-plugin';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { TokenSigner } from '../../../domain/ports';
import { UnauthenticatedError } from '../../../domain/errors';

export interface AuthenticatedUser {
  readonly id: string;
}

export interface AuthPluginOptions {
  readonly tokenSigner: TokenSigner;
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
const plugin: FastifyPluginCallback<AuthPluginOptions> = (app, { tokenSigner }, done) => {
  app.decorateRequest('authenticatedUser', undefined);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header === undefined ? null : BEARER.exec(header);
    const token = match?.[1];

    if (token === undefined) {
      throw new UnauthenticatedError();
    }

    // A recusa sobe como erro tipado e o tratador central monta a resposta.
    // Responder aqui duplicaria o formato do corpo em mais um lugar, e o
    // emissor já distingue vencido de inválido — distinção que o cliente usa
    // para decidir entre renovar e autenticar de novo.
    const claims = await tokenSigner.verify(token);

    request.authenticatedUser = { id: claims.sub };
  });

  done();
};

export const authPlugin = fp(plugin, { name: 'auth' });

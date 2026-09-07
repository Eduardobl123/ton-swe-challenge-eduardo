import { rateLimitSubject } from '../../../application/rate-limit';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Container } from '../../../main/container';
import { authenticatedUserId } from '../plugins/auth';
import { problemResponses } from '../schemas/common.schemas';
import { listProductsQuerySchema, listProductsResponseSchema } from '../schemas/products.schemas';

export const productRoutes =
  (container: Container): FastifyPluginAsyncZod =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async (app) => {
    app.get(
      '/products',
      {
        // A verificação do token vem antes da cota de propósito: a chave é o
        // identificador do usuário. Limitar por origem numa rota autenticada
        // puniria todos os clientes atrás de um mesmo NAT.
        onRequest: [
          app.authenticate,
          app.enforceRateLimit(container.policies.rateLimit.productsList, (request) =>
            rateLimitSubject.user(authenticatedUserId(request)),
          ),
        ],
        schema: {
          tags: ['Catálogo'],
          summary: 'Lista os produtos ativos',
          description:
            'Paginação por cursor. Siga `page.nextCursor` até ele vir ausente; ' +
            'não existe contagem total nem número de página.',
          security: [{ bearerAuth: [] }],
          querystring: listProductsQuerySchema,
          response: { 200: listProductsResponseSchema, ...problemResponses },
        },
      },
      async (request, reply) => {
        const saida = await container.useCases.listProducts.execute({
          limit: request.query.limit,
          cursor: request.query.cursor,
        });

        if (saida.page.limitClamped) {
          // Avisa que o cliente recebeu menos do que pediu, para que ele não
          // conclua que a lista acabou.
          //
          // Sem `void`: o objeto de resposta do Fastify é aguardável e só
          // resolve quando a resposta sai, então `await` aqui esperaria por algo
          // que depende deste próprio handler terminar.
          void reply.header('X-Limit-Clamped', 'true');
        }

        // A chave é omitida na última página, em vez de sair como nula. Um campo
        // ausente é mais barato de checar do lado do cliente e não convida a
        // repassar `null` como cursor na requisição seguinte.
        const { nextCursor, ...page } = saida.page;

        return {
          // Cópia mutável: o DTO devolve arranjo somente-leitura, e o
          // serializador do schema espera um comum.
          data: [...saida.data],
          page: nextCursor === undefined ? page : { ...page, nextCursor },
        };
      },
    );
  };

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Container } from '../../../main/container';

const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

const readinessSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
});

/**
 * Sondas operacionais.
 *
 * Ficam fora do prefixo de versão e fora da cota. Elas servem a orquestrador e
 * a verificação de disponibilidade, não a consumidor da API: mudar de endereço
 * quando o contrato de negócio evoluir quebraria a infraestrutura, e limitar as
 * chamadas faria a própria checagem derrubar o serviço.
 *
 * A separação entre as duas é o que evita o pior modo de falha operacional:
 * `/health` responde enquanto o processo estiver vivo, e reiniciar um serviço
 * cuja **dependência** caiu não resolve nada. Quem responde por dependência é
 * `/ready`, e o efeito dela é tirar a instância do balanceamento, não matá-la.
 */
export const healthRoutes =
  (container: Container): FastifyPluginAsyncZod =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async (app) => {
    app.get(
      '/health',
      {
        schema: {
          tags: ['Operação'],
          summary: 'Indica que o processo está vivo',
          response: { 200: healthSchema },
        },
      },
      () => ({ status: 'ok' as const, version: container.config.version }),
    );

    app.get(
      '/ready',
      {
        schema: {
          tags: ['Operação'],
          summary: 'Indica que as dependências respondem',
          response: { 200: readinessSchema, 503: readinessSchema },
        },
      },
      async (_request, reply) => {
        const ready = await container.services.readiness.check();

        return reply.status(ready ? 200 : 503).send({
          status: ready ? ('ready' as const) : ('unavailable' as const),
        });
      },
    );
  };

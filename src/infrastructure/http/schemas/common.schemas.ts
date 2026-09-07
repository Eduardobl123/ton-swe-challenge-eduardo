import { z } from 'zod';
import { ERROR_CODES } from '../../../domain/errors';

/**
 * Corpo de erro, no formato da RFC 9457.
 *
 * Declará-lo uma vez e reaproveitá-lo em todas as rotas é o que faz a
 * documentação prometer o mesmo formato em toda parte — e o que impede que uma
 * rota nova invente o seu próprio.
 */
export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(ERROR_CODES),
    instance: z.string(),
    requestId: z.string(),
    errors: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional()
      .describe('Presente apenas em falhas de validação.'),
  })
  .describe('Erro no formato RFC 9457.');

/**
 * Os status de erro que qualquer rota pode devolver.
 *
 * A lista inclui o que o próprio Fastify recusa antes de a rota executar — corpo
 * acima do teto e mídia não suportada. Eles não aparecem no código das rotas, e
 * por isso ficaram fora da documentação até os testes ponta a ponta compararem
 * resposta real com contrato publicado: a API respondia 413 e 415 a quem só
 * tinha sido avisado de 400, 401, 429 e 500.
 */
export const problemResponses = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  413: problemDetailsSchema,
  415: problemDetailsSchema,
  429: problemDetailsSchema,
  500: problemDetailsSchema,
} as const;

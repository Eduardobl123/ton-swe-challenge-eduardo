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

export const problemResponses = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  429: problemDetailsSchema,
  500: problemDetailsSchema,
} as const;

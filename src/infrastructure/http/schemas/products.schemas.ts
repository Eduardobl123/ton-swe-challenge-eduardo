import { z } from 'zod';

export const listProductsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Itens por página. Padrão 20, teto 100. Acima do teto é ajustado, não recusado.'),
    cursor: z
      .string()
      .max(2048)
      .optional()
      .describe('Continuação devolvida na página anterior. Trate como texto opaco.'),
  })
  .describe('Parâmetros de paginação.');

export const productViewSchema = z
  .object({
    id: z.string(),
    sku: z.string(),
    name: z.string(),
    description: z.string(),
    priceCents: z.number().int().describe('Preço em centavos inteiros.'),
    createdAt: z.iso.datetime(),
  })
  .describe('Produto do catálogo.');

export const listProductsResponseSchema = z
  .object({
    data: z.array(productViewSchema),
    page: z.object({
      limit: z.number().int().describe('Tamanho efetivamente aplicado.'),
      nextCursor: z.string().optional().describe('Ausente na última página. Devolva como recebeu.'),
      hasMore: z.boolean(),
      limitClamped: z.boolean().describe('Verdadeiro quando o limite pedido foi ajustado.'),
    }),
  })
  .describe('Página do catálogo.');

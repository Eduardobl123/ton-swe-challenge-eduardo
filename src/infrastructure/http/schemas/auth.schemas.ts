import { z } from 'zod';

/**
 * Limites do que entra.
 *
 * O teto da senha não é estético: sem ele, um corpo de dezenas de kilobytes
 * seria derivado inteiro pelo argon2id, que custa 19 MiB e alguns
 * milissegundos. Pedido barato de enviar e caro de atender é a receita de uma
 * negação de serviço. O caso de uso repete a checagem, como segunda linha.
 */
export const loginBodySchema = z
  .object({
    email: z.email().max(254).describe('E-mail cadastrado.'),
    password: z.string().min(8).max(128).describe('Senha, de 8 a 128 caracteres.'),
  })
  .describe('Credenciais de acesso.');

export const sessionResponseSchema = z
  .object({
    accessToken: z.string().describe('JWT de acesso, usado no cabeçalho Authorization.'),
    refreshToken: z
      .string()
      .describe('Credencial de renovação, de uso único. Guarde com o mesmo cuidado da senha.'),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().describe('Validade do access token, em segundos.'),
  })
  .describe('Par de credenciais da sessão.');

export const loginResponseSchema = sessionResponseSchema
  .extend({ userId: z.string() })
  .describe('Sessão recém-criada.');

export const refreshBodySchema = z
  .object({ refreshToken: z.string().min(1).max(512) })
  .describe('Credencial de renovação obtida no login ou na renovação anterior.');

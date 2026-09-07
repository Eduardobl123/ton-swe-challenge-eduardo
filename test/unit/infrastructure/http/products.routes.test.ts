import { beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { bearer, buildTestApp, login, type TestApp } from '../../../support/http';

const SECRET = 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

interface Pagina {
  readonly data: { id: string; sku: string }[];
  readonly page: { limit: number; nextCursor?: string; hasMore: boolean; limitClamped: boolean };
}

describe('GET /v1/products', () => {
  let ctx: TestApp;
  let token: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = (await login(ctx.app)).accessToken;
  });

  const listar = async (
    query = '',
  ): Promise<{ status: number; body: Pagina; headers: Record<string, unknown> }> => {
    const resposta = await ctx.app.inject({
      method: 'GET',
      url: `/v1/products${query}`,
      headers: bearer(token),
    });

    return {
      status: resposta.statusCode,
      body: resposta.json<Pagina>(),
      headers: resposta.headers,
    };
  };

  describe('autenticação', () => {
    it('recusa sem token', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/v1/products' });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it.each([
      ['sem o prefixo Bearer', { authorization: 'apenas-o-token' }],
      ['com esquema errado', { authorization: 'Basic abc' }],
      ['vazio', { authorization: '' }],
    ])('recusa cabeçalho %s', async (_caso, headers) => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/v1/products', headers });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('recusa token assinado com outro segredo', async () => {
      const forjado = await new SignJWT()
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer('ton-swe-challenge')
        .setAudience('ton-swe-challenge-api')
        .setIssuedAt()
        .setExpirationTime('15m')
        .setJti('forjado')
        .sign(new TextEncoder().encode('outro-segredo-completamente-diferente'));

      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(forjado),
      });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it.each([
      ['emissor divergente', 'outro-servico', 'ton-swe-challenge-api'],
      ['público divergente', 'ton-swe-challenge', 'outra-api'],
    ])('recusa %s como inválido, não como expirado', async (_caso, issuer, audience) => {
      // Regressão do achado P3. A classificação era feita pela mensagem da
      // biblioteca, e "unexpected" contém a mesma sequência que "expired": o
      // cliente era mandado renovar quando deveria autenticar de novo.
      const token = await new SignJWT()
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .setJti('j')
        .sign(new TextEncoder().encode(SECRET));

      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(token),
      });

      expect(resposta.json()).toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it('distingue token expirado de token inválido', async () => {
      // O cliente já tem o token e pode lê-lo sozinho, então dizer que expirou
      // não vaza nada — e é o que lhe diz para renovar em vez de pedir a senha.
      const expirado = await new SignJWT()
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer('ton-swe-challenge')
        .setAudience('ton-swe-challenge-api')
        .setIssuedAt(1_000)
        .setExpirationTime(1_001)
        .setJti('expirado')
        .sign(new TextEncoder().encode(SECRET));

      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(expirado),
      });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
    });
  });

  describe('paginação', () => {
    it('lista com o token válido', async () => {
      const { status, body } = await listar('?limit=5');

      expect(status).toBe(200);
      expect(body.data).toHaveLength(5);
      expect(body.page.limit).toBe(5);
    });

    it('percorre as páginas sem repetir item', async () => {
      const vistos: string[] = [];
      let cursor: string | undefined;

      do {
        const { body } = await listar(
          `?limit=10${cursor === undefined ? '' : `&cursor=${cursor}`}`,
        );
        vistos.push(...body.data.map((p) => p.sku));
        cursor = body.page.nextCursor;
      } while (cursor !== undefined);

      expect(vistos).toHaveLength(42);
      expect(new Set(vistos).size).toBe(42);
    });

    it('omite o cursor na última página', async () => {
      const { body } = await listar('?limit=100');

      expect(body.page.nextCursor).toBeUndefined();
      expect(body.page.hasMore).toBe(false);
    });

    it('ajusta o limite acima do teto e avisa no cabeçalho', async () => {
      const { body, headers } = await listar('?limit=1000');

      expect(body.page.limit).toBe(100);
      expect(body.page.limitClamped).toBe(true);
      expect(headers['x-limit-clamped']).toBe('true');
    });

    it('não envia o cabeçalho de ajuste quando não houve ajuste', async () => {
      const { headers } = await listar('?limit=10');

      expect(headers['x-limit-clamped']).toBeUndefined();
    });

    it('recusa cursor forjado', async () => {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/v1/products?cursor=forjado',
        headers: bearer(token),
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    });

    it.each(['abc', '0', '-1'])('recusa limite inválido: %s', async (limit) => {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: `/v1/products?limit=${limit}`,
        headers: bearer(token),
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('não expõe a bandeira de ativo nem campos internos', async () => {
      const { body } = await listar('?limit=1');

      expect(Object.keys(body.data[0]!).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'name',
        'priceCents',
        'sku',
      ]);
    });
  });

  describe('cota', () => {
    it('informa limite e saldo mesmo quando a requisição passa', async () => {
      const { headers } = await listar('?limit=1');

      expect(headers['ratelimit-limit']).toBe('60');
      expect(headers['ratelimit-remaining']).toBe('59');
      expect(headers['ratelimit-reset']).toBeDefined();
    });

    it('recusa com 429 e Retry-After ao estourar', async () => {
      const app = (await buildTestApp({ RATE_LIMIT_PRODUCTS_PER_MINUTE: '3' })).app;
      const sessao = await login(app);

      for (let i = 0; i < 3; i += 1) {
        const permitida = await app.inject({
          method: 'GET',
          url: '/v1/products?limit=1',
          headers: bearer(sessao.accessToken),
        });
        expect(permitida.statusCode).toBe(200);
      }

      const excedente = await app.inject({
        method: 'GET',
        url: '/v1/products?limit=1',
        headers: bearer(sessao.accessToken),
      });

      expect(excedente.statusCode).toBe(429);
      expect(excedente.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
      expect(Number(excedente.headers['retry-after'])).toBeGreaterThan(0);
      expect(excedente.headers['ratelimit-remaining']).toBe('0');
    });
  });
});

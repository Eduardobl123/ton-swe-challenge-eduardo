import { beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  buildAppWithFailingList,
  buildAppWithReadiness,
  buildTestApp,
  login,
  type TestApp,
} from '../../../support/http';

describe('aplicação HTTP', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  describe('sondas operacionais', () => {
    it('/health responde sem autenticação', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ status: 'ok', version: 'local' });
    });

    it('/ready responde sem autenticação', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/ready' });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ status: 'ready' });
    });

    it('/ready devolve 503 quando a dependência não responde', async () => {
      // O efeito de não estar pronto é sair do balanceamento, não ser morto:
      // reiniciar um serviço cuja dependência caiu não resolve nada.
      const app = await buildAppWithReadiness(false);

      const resposta = await app.inject({ method: 'GET', url: '/ready' });

      expect(resposta.statusCode).toBe(503);
      expect(resposta.json()).toEqual({ status: 'unavailable' });
      await app.close();
    });

    it('as sondas ficam fora do prefixo de versão', async () => {
      // Elas servem a orquestrador, não a consumidor da API: mudar de endereço
      // quando o contrato de negócio evoluir quebraria a infraestrutura.
      const versionada = await ctx.app.inject({ method: 'GET', url: '/v1/health' });

      expect(versionada.statusCode).toBe(404);
    });

    it('as sondas não consomem cota', async () => {
      for (let i = 0; i < 30; i += 1) {
        const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });
        expect(resposta.statusCode).toBe(200);
      }
    });
  });

  describe('formato de erro', () => {
    it('rota inexistente devolve o mesmo formato das demais', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/v1/nao-existe' });

      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        instance: '/v1/nao-existe',
      });
    });

    it('todo erro carrega os mesmos campos', async () => {
      const respostas = await Promise.all([
        ctx.app.inject({ method: 'GET', url: '/v1/nao-existe' }),
        ctx.app.inject({ method: 'GET', url: '/v1/products' }),
        ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: {} }),
      ]);

      for (const resposta of respostas) {
        expect(Object.keys(resposta.json<Record<string, unknown>>())).toEqual(
          expect.arrayContaining(['type', 'title', 'status', 'code', 'instance', 'requestId']),
        );
      }
    });

    it('o corpo nunca traz detalhe interno de exceção', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/v1/nao-existe' });

      expect(resposta.body).not.toMatch(/at .*\.ts:|node_modules|stack/i);
    });

    it('corpo malformado vira 400, não 500', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '{isso não é json',
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('falha imprevista vira 500 sem detalhe para o cliente', async () => {
      // Devolver a mensagem de uma exceção não tratada entregaria caminho de
      // arquivo e nome de tabela.
      const app = await buildAppWithFailingList('throws');
      const sessao = await login(app);

      const resposta = await app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(sessao.accessToken),
      });

      expect(resposta.statusCode).toBe(500);
      expect(resposta.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(resposta.body).not.toContain('falha interna inesperada');
      await app.close();
    });

    it('resposta fora do contrato declarado vira 500, não corpo torto', async () => {
      // É defeito nosso, não do cliente: entregar a resposta errada seria pior
      // que recusar, porque o consumidor programaria em cima dela.
      const app = await buildAppWithFailingList('invalid-shape');
      const sessao = await login(app);

      const resposta = await app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(sessao.accessToken),
      });

      expect(resposta.statusCode).toBe(500);
      expect(resposta.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
      await app.close();
    });

    it('corpo grande demais é recusado', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(100_000) }),
      });

      expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
      expect(resposta.statusCode).toBeLessThan(500);
    });
  });

  describe('identificador de requisição', () => {
    it('é devolvido em toda resposta', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });

      expect(resposta.headers['x-request-id']).toBeDefined();
    });

    it('propaga o recebido, para permitir seguir a requisição entre serviços', async () => {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'vindo-de-fora' },
      });

      expect(resposta.headers['x-request-id']).toBe('vindo-de-fora');
    });

    it('normaliza cabeçalho repetido em um único valor', async () => {
      // O Fastify junta ocorrências repetidas antes de entregar ao gancho.
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': ['primeiro', 'segundo'] },
      });

      expect(resposta.headers['x-request-id']).toBe('primeiro,segundo');
    });

    it('gera um novo quando o recebido é absurdamente longo', async () => {
      // O valor vem de fora e entra em toda linha de log da requisição.
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'a'.repeat(500) },
      });

      expect(resposta.headers['x-request-id']).not.toBe('a'.repeat(500));
    });

    it('o mesmo identificador aparece no corpo do erro', async () => {
      const resposta = await ctx.app.inject({
        method: 'GET',
        url: '/v1/nao-existe',
        headers: { 'x-request-id': 'correlacao-123' },
      });

      expect(resposta.json()).toMatchObject({ requestId: 'correlacao-123' });
      expect(resposta.headers['x-request-id']).toBe('correlacao-123');
    });
  });

  describe('CORS', () => {
    it('restringe às origens configuradas', async () => {
      const { app } = await buildTestApp({ CORS_ORIGINS: 'https://app.ton.com.br' });

      const permitida = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://app.ton.com.br' },
      });
      const recusada = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://site-qualquer.com' },
      });

      expect(permitida.headers['access-control-allow-origin']).toBe('https://app.ton.com.br');
      expect(recusada.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    });
  });

  describe('cabeçalhos de segurança', () => {
    it('aplica os cabeçalhos do helmet', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });

      expect(resposta.headers['x-content-type-options']).toBe('nosniff');
      expect(resposta.headers['x-frame-options']).toBeDefined();
    });

    it('não anuncia o framework', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });

      expect(resposta.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('documentação', () => {
    it('pode ser desligada por ambiente', async () => {
      const resposta = await ctx.app.inject({ method: 'GET', url: '/docs' });

      expect(resposta.statusCode).toBe(404);
    });

    it('quando ligada, publica o contrato de todas as rotas', async () => {
      const { app } = await buildTestApp({ SWAGGER_ENABLED: 'true' });

      const resposta = await app.inject({ method: 'GET', url: '/docs/json' });
      const spec = resposta.json<{ openapi: string; paths: Record<string, unknown> }>();

      expect(spec.openapi).toBe('3.1.0');
      expect(Object.keys(spec.paths).sort()).toEqual([
        '/health',
        '/ready',
        '/v1/auth/login',
        '/v1/auth/logout',
        '/v1/auth/refresh',
        '/v1/products',
      ]);
      await app.close();
    });
  });

  it('a jornada completa funciona pela borda HTTP', async () => {
    const sessao = await login(ctx.app);

    const listagem = await ctx.app.inject({
      method: 'GET',
      url: '/v1/products?limit=3',
      headers: bearer(sessao.accessToken),
    });
    expect(listagem.statusCode).toBe(200);

    const renovada = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: sessao.refreshToken },
    });
    const nova = renovada.json<{ accessToken: string; refreshToken: string }>();

    const comTokenNovo = await ctx.app.inject({
      method: 'GET',
      url: '/v1/products?limit=3',
      headers: bearer(nova.accessToken),
    });
    expect(comTokenNovo.statusCode).toBe(200);

    const saida = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(nova.accessToken),
      payload: { refreshToken: nova.refreshToken },
    });
    expect(saida.statusCode).toBe(204);

    const depois = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: nova.refreshToken },
    });
    expect(depois.statusCode).toBe(401);
  });
});

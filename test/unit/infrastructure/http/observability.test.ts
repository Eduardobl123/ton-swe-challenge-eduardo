import { beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  buildAppWithFailingList,
  buildTestApp,
  login,
  type TestApp,
} from '../../../support/http';

describe('observabilidade da borda HTTP', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  describe('correlação', () => {
    it('o identificador da resposta é o mesmo do log da requisição', async () => {
      // É o que fecha o ciclo: da reclamação de quem usou, para a linha de log,
      // para o evento com a pilha.
      const resposta = await ctx.app.inject({ method: 'GET', url: '/health' });

      const registro = ctx.logger.find('http.request');
      expect(registro?.fields.requestId).toBe(resposta.headers['x-request-id']);
    });

    it('o identificador recebido de fora é o que aparece no log', async () => {
      await ctx.app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'veio-de-outro-servico' },
      });

      expect(ctx.logger.find('http.request')?.fields.requestId).toBe('veio-de-outro-servico');
    });

    it('o mesmo identificador chega ao relato de erro e ao corpo devolvido', async () => {
      const { app, reported } = await buildAppWithFailingList('throws');
      const sessao = await login(app);

      const resposta = await app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: { ...bearer(sessao.accessToken), 'x-request-id': 'correlacao-123' },
      });

      expect(resposta.json()).toMatchObject({ requestId: 'correlacao-123' });
      expect(reported[0]?.context.requestId).toBe('correlacao-123');
      await app.close();
    });
  });

  describe('registro da requisição', () => {
    it('anota método, rota, status e duração', async () => {
      const sessao = await login(ctx.app);

      await ctx.app.inject({
        method: 'GET',
        url: '/v1/products?limit=1',
        headers: bearer(sessao.accessToken),
      });

      const registro = ctx.logger.records.filter((r) => r.event === 'http.request').at(-1);
      expect(registro?.fields).toMatchObject({
        method: 'GET',
        route: '/v1/products',
        statusCode: 200,
      });
      expect(Number(registro?.fields.durationMs)).toBeGreaterThanOrEqual(0);
    });

    it('usa o padrão da rota, e não a URL recebida', async () => {
      // A URL traria o cursor e viraria cardinalidade infinita, tanto no log
      // quanto na métrica.
      const sessao = await login(ctx.app);
      const pagina = await ctx.app.inject({
        method: 'GET',
        url: '/v1/products?limit=1',
        headers: bearer(sessao.accessToken),
      });
      const cursor = pagina.json<{ page: { nextCursor: string } }>().page.nextCursor;

      await ctx.app.inject({
        method: 'GET',
        url: `/v1/products?limit=1&cursor=${encodeURIComponent(cursor)}`,
        headers: bearer(sessao.accessToken),
      });

      const rotas = ctx.logger.records
        .filter((r) => r.event === 'http.request')
        .map((r) => r.fields.route);
      expect(new Set(rotas.filter((r) => r === '/v1/products')).size).toBe(1);
      expect(rotas.join(' ')).not.toContain('cursor');
    });

    it('identifica o usuário nas rotas autenticadas', async () => {
      const sessao = await login(ctx.app);

      await ctx.app.inject({
        method: 'GET',
        url: '/v1/products?limit=1',
        headers: bearer(sessao.accessToken),
      });

      const registro = ctx.logger.records.filter((r) => r.event === 'http.request').at(-1);
      expect(registro?.fields.userId).toBeTruthy();
    });

    it('nunca registra a credencial apresentada', async () => {
      const sessao = await login(ctx.app);
      await ctx.app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(sessao.accessToken),
      });

      const registrado = ctx.logger.dump();
      expect(registrado).not.toContain(sessao.accessToken);
      expect(registrado).not.toContain(sessao.refreshToken);
      expect(registrado).not.toContain('Desafio@Ton2026');
    });
  });

  describe('métricas', () => {
    it('mede a duração de toda requisição, com a rota como dimensão', async () => {
      await ctx.app.inject({ method: 'GET', url: '/health' });

      const metrica = ctx.metrics.find('RequestDuration');
      expect(metrica?.unit).toBe('Milliseconds');
      expect(metrica?.dimensions).toMatchObject({ Route: '/health' });
    });

    it('conta login bem-sucedido', async () => {
      await login(ctx.app);

      expect(ctx.metrics.names()).toContain('LoginSuccess');
      expect(ctx.metrics.names()).not.toContain('LoginFailure');
    });

    it('conta login recusado', async () => {
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'demo@ton.com.br', password: 'errada-mas-longa' },
      });

      expect(ctx.metrics.names()).toContain('LoginFailure');
      expect(ctx.metrics.names()).not.toContain('LoginSuccess');
    });

    it('conta requisição barrada pela cota', async () => {
      const { app, metrics } = await buildTestApp({ RATE_LIMIT_PRODUCTS_PER_MINUTE: '1' });
      const sessao = await login(app);
      const chamar = () =>
        app.inject({
          method: 'GET',
          url: '/v1/products?limit=1',
          headers: bearer(sessao.accessToken),
        });

      await chamar();
      await chamar();

      expect(metrics.names()).toContain('RateLimited');
      await app.close();
    });

    it('conta falha imprevista do servidor', async () => {
      const { app } = await buildAppWithFailingList('throws');
      const sessao = await login(app);

      const resposta = await app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(sessao.accessToken),
      });

      expect(resposta.statusCode).toBe(500);
      await app.close();
    });
  });

  describe('o que vai e o que não vai para o relato de erro', () => {
    it('falha imprevista é relatada', async () => {
      const { app, reported } = await buildAppWithFailingList('throws');
      const sessao = await login(app);

      await app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: bearer(sessao.accessToken),
      });

      expect(reported).toHaveLength(1);
      expect(reported[0]?.context.route).toBe('/v1/products');
      expect(reported[0]?.context.userId).toBeTruthy();
      await app.close();
    });

    it.each([
      ['credencial inválida', 'POST', '/v1/auth/login'],
      ['rota inexistente', 'GET', '/v1/nao-existe'],
      ['sem autenticação', 'GET', '/v1/products'],
    ])('resultado previsto não vira alerta: %s', async (_caso, method, url) => {
      // Enviá-los encheria o alerta de eventos cotidianos até ninguém mais
      // olhar para ele.
      await ctx.app.inject({
        method: method as 'GET' | 'POST',
        url,
        payload: { email: 'demo@ton.com.br', password: 'errada-mas-longa' },
      });

      expect(ctx.reported).toHaveLength(0);
    });

    it('cota excedida também não vira alerta', async () => {
      const { app, reported } = await buildTestApp({ RATE_LIMIT_LOGIN_PER_MINUTE: '1' });

      await login(app);
      await login(app);

      expect(reported).toHaveLength(0);
      await app.close();
    });
  });
});

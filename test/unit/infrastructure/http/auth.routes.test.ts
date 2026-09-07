import { beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../../../src/domain/entities';
import { Email } from '../../../../src/domain/value-objects';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  bearer,
  buildTestApp,
  login,
  type TestApp,
} from '../../../support/http';

describe('rotas de autenticação', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  describe('POST /v1/auth/login', () => {
    it('devolve o par de credenciais', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(resposta.json<{ accessToken: string }>().accessToken).toBeTruthy();
      expect(resposta.json<{ refreshToken: string }>().refreshToken).toBeTruthy();
    });

    it('aceita o e-mail em qualquer caixa', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'DEMO@TON.COM.BR', password: DEMO_PASSWORD },
      });

      expect(resposta.statusCode).toBe(200);
    });

    it.each([
      ['senha errada', { email: DEMO_EMAIL, password: 'senha-errada-mas-longa' }],
      ['conta inexistente', { email: 'ninguem@ton.com.br', password: DEMO_PASSWORD }],
    ])('recusa %s com resposta idêntica', async (_caso, payload) => {
      const resposta = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    });

    it('as duas recusas têm corpo idêntico, tirando o identificador', async () => {
      // É o que sustenta a defesa contra enumeração de contas na borda: não
      // adianta o caso de uso equalizar se a resposta HTTP diferenciar.
      const semConta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'ninguem@ton.com.br', password: DEMO_PASSWORD },
      });
      const senhaErrada = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: DEMO_EMAIL, password: 'outra-senha-qualquer' },
      });

      const semRequestId = (corpo: Record<string, unknown>): Record<string, unknown> => {
        const { requestId: _ignorado, ...resto } = corpo;
        return resto;
      };

      expect(semRequestId(semConta.json())).toEqual(semRequestId(senhaErrada.json()));
    });

    it('conta bloqueada responde igual a senha errada', async () => {
      for (let i = 0; i < 5; i += 1) {
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: DEMO_EMAIL, password: 'errada-de-proposito' },
        });
      }

      const comSenhaCerta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });

      expect(comSenhaCerta.statusCode).toBe(401);
      expect(comSenhaCerta.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(ctx.logger.events()).toContain('auth.login.locked');
    });

    it.each([
      ['e-mail malformado', { email: 'nao-e-email', password: DEMO_PASSWORD }],
      ['senha curta demais', { email: DEMO_EMAIL, password: 'curta' }],
      ['senha longa demais', { email: DEMO_EMAIL, password: 'a'.repeat(129) }],
      ['corpo sem senha', { email: DEMO_EMAIL }],
      ['corpo vazio', {}],
    ])('recusa %s com 400 e a lista de campos', async (_caso, payload) => {
      const resposta = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(resposta.json<{ errors: unknown[] }>().errors.length).toBeGreaterThan(0);
    });

    it('senha longa demais nem chega ao verificador de hash', async () => {
      // Derivar argon2 de um corpo enorme é o custo que o teto existe para
      // evitar. O schema barra antes.
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: DEMO_EMAIL, password: 'a'.repeat(5_000) },
      });

      expect(ctx.logger.events()).not.toContain('auth.login.failed');
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('rotaciona e emite um par novo', async () => {
      const sessao = await login(ctx.app);

      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: sessao.refreshToken },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<{ refreshToken: string }>().refreshToken).not.toBe(sessao.refreshToken);
    });

    it('reapresentar o token antigo derruba a sessão inteira', async () => {
      const sessao = await login(ctx.app);
      const renovada = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: sessao.refreshToken },
      });
      const novo = renovada.json<{ refreshToken: string }>().refreshToken;

      const reuso = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: sessao.refreshToken },
      });
      const depois = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: novo },
      });

      expect(reuso.statusCode).toBe(401);
      expect(reuso.json()).toMatchObject({ code: 'REFRESH_TOKEN_INVALID' });
      expect(depois.statusCode).toBe(401);
    });

    it('recusa token desconhecido', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: 'nunca-emitido' },
      });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'REFRESH_TOKEN_INVALID' });
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('encerra a sessão e devolve 204 sem corpo', async () => {
      const sessao = await login(ctx.app);

      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: bearer(sessao.accessToken),
        payload: { refreshToken: sessao.refreshToken },
      });

      expect(resposta.statusCode).toBe(204);
      expect(resposta.body).toBe('');
    });

    it('a renovação deixa de funcionar depois', async () => {
      const sessao = await login(ctx.app);
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: bearer(sessao.accessToken),
        payload: { refreshToken: sessao.refreshToken },
      });

      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: sessao.refreshToken },
      });

      expect(resposta.statusCode).toBe(401);
    });

    it('não encerra a sessão de outro usuário', async () => {
      // Regressão do achado P2. A rota exigia credencial e não usava a
      // identidade para nada, então bastava apresentar o token alheio.
      const { app, container } = await buildTestApp();
      await container.seeding.users.save(
        User.create({
          id: container.seeding.idGenerator.next(),
          email: Email.create('outro@ton.com.br'),
          passwordHash: await container.seeding.passwordHasher.hash(DEMO_PASSWORD),
          failedLoginAttempts: 0,
          lockedUntil: undefined,
          createdAt: container.seeding.clock.now(),
          version: 0,
        }),
      );

      const meu = await login(app);
      const alheio = await login(app, 'outro@ton.com.br', DEMO_PASSWORD);

      const resposta = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: bearer(meu.accessToken),
        payload: { refreshToken: alheio.refreshToken },
      });

      // Resposta idêntica à do caminho feliz: revelar a divergência diria a
      // quem sonda que aquele token existe.
      expect(resposta.statusCode).toBe(204);

      const aindaVale = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: alheio.refreshToken },
      });
      expect(aindaVale.statusCode).toBe(200);
      await app.close();
    });

    it('exige autenticação', async () => {
      const sessao = await login(ctx.app);

      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        payload: { refreshToken: sessao.refreshToken },
      });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });
});

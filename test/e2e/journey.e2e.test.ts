import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentedRoutes } from './support/openapi-contract';
import { SENHA, semearProdutos, subirAmbiente, type Ambiente } from './support/journey';

const EMAIL = 'jornada@ton.com.br';
const TOTAL_DE_PRODUTOS = 25;
const POR_PAGINA = 10;

interface Sessao {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  userId?: string;
}

interface Pagina {
  data: { id: string; sku: string; priceCents: number }[];
  page: { limit: number; hasMore: boolean; limitClamped: boolean; nextCursor?: string };
}

interface Problema {
  code: string;
  status: number;
  requestId: string;
}

let env: Ambiente;

/**
 * A jornada de quem usa a API, do login ao logout, contra o banco de verdade.
 *
 * O que só aparece aqui é a continuidade: o token emitido em uma requisição
 * autenticando a seguinte, o cursor devolvido por uma página buscando a
 * próxima, a rotação invalidando o que veio antes. Nenhuma dessas transições
 * existe dentro de um teste de unidade, porque em unidade cada peça recebe a
 * entrada pronta.
 *
 * Toda resposta é conferida contra `docs/openapi.json` — inclusive as de erro —
 * pelo próprio `chamar`. Divergência entre documentação e implementação falha o
 * teste no ponto onde acontece.
 */
describe('jornada completa', () => {
  beforeAll(async () => {
    env = await subirAmbiente('journey');
    await env.criarUsuario(EMAIL);
    await semearProdutos(env.container, TOTAL_DE_PRODUTOS);
  }, 60_000);

  afterAll(async () => {
    await env.encerrar();
  });

  it('percorre login, paginação, renovação, reuso e logout', async () => {
    const vivo = await env.chamar('GET', '/health');
    expect(vivo.statusCode).toBe(200);

    const pronto = await env.chamar('GET', '/ready');
    expect(pronto.statusCode).toBe(200);
    expect(pronto.json<{ status: string }>().status).toBe('ready');

    // --- login ---------------------------------------------------------------
    const login = await env.chamar('POST', '/v1/auth/login', {
      payload: { email: EMAIL, password: SENHA },
    });
    expect(login.statusCode).toBe(200);

    const sessao = login.json<Sessao>();
    expect(sessao.tokenType).toBe('Bearer');
    expect(sessao.expiresIn).toBeGreaterThan(0);
    // O access token é um JWT de três partes; o refresh é opaco, e não deve
    // parecer um: quem confundir os dois tentaria lê-lo no cliente.
    expect(sessao.accessToken.split('.')).toHaveLength(3);
    expect(sessao.refreshToken).not.toContain('.');

    const autenticado = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

    // --- paginação por cursor ------------------------------------------------
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;

    do {
      const url =
        cursor === undefined
          ? `/v1/products?limit=${String(POR_PAGINA)}`
          : `/v1/products?limit=${String(POR_PAGINA)}&cursor=${encodeURIComponent(cursor)}`;
      const resposta = await env.chamar('GET', url, autenticado(sessao.accessToken));

      expect(resposta.statusCode).toBe(200);

      const pagina = resposta.json<Pagina>();

      expect(pagina.page.limit).toBe(POR_PAGINA);
      expect(pagina.page.limitClamped).toBe(false);
      // A última página não oferece continuação, e nenhuma outra deixa de
      // oferecer: é o par que impede tanto o laço infinito quanto a parada cedo.
      expect(pagina.page.hasMore).toBe(pagina.page.nextCursor !== undefined);

      vistos.push(...pagina.data.map((produto) => produto.id));
      cursor = pagina.page.nextCursor;
      paginas += 1;

      expect(paginas).toBeLessThanOrEqual(TOTAL_DE_PRODUTOS);
    } while (cursor !== undefined);

    expect(paginas).toBe(Math.ceil(TOTAL_DE_PRODUTOS / POR_PAGINA));
    expect(vistos).toHaveLength(TOTAL_DE_PRODUTOS);
    // Sem repetição e sem buraco: a paginação por cursor existe para garantir
    // exatamente isso quando a página seguinte é buscada em outro instante.
    expect(new Set(vistos).size).toBe(TOTAL_DE_PRODUTOS);

    // --- renovação -----------------------------------------------------------
    const renovacao = await env.chamar('POST', '/v1/auth/refresh', {
      payload: { refreshToken: sessao.refreshToken },
    });
    expect(renovacao.statusCode).toBe(200);

    const nova = renovacao.json<Sessao>();
    expect(nova.refreshToken).not.toBe(sessao.refreshToken);
    expect(nova.accessToken).not.toBe(sessao.accessToken);

    const comTokenNovo = await env.chamar(
      'GET',
      `/v1/products?limit=${String(POR_PAGINA)}`,
      autenticado(nova.accessToken),
    );
    expect(comTokenNovo.statusCode).toBe(200);

    // --- reuso do refresh antigo --------------------------------------------
    const reuso = await env.chamar('POST', '/v1/auth/refresh', {
      payload: { refreshToken: sessao.refreshToken },
    });
    expect(reuso.statusCode).toBe(401);
    // O cliente recebe a mesma resposta de um token qualquer que não vale.
    // Avisar "detectei reuso" só ensinaria a quem ataca que a cópia foi notada;
    // quem precisa saber é quem opera, e sabe pelo log.
    expect(reuso.json<Problema>().code).toBe('REFRESH_TOKEN_INVALID');

    // O ponto do mecanismo: quem roubou o token e quem é dono ficam ambos de
    // fora. Derrubar só o token apresentado deixaria o atacante com o par novo.
    const depoisDoReuso = await env.chamar('POST', '/v1/auth/refresh', {
      payload: { refreshToken: nova.refreshToken },
    });
    expect(depoisDoReuso.statusCode).toBe(401);

    expect(env.logger.events()).toContain('auth.refresh.reuse_detected');
  }, 120_000);

  it('encerra a sessão e a renovação deixa de valer', async () => {
    const login = await env.chamar('POST', '/v1/auth/login', {
      payload: { email: EMAIL, password: SENHA },
    });
    const sessao = login.json<Sessao>();

    const logout = await env.chamar('POST', '/v1/auth/logout', {
      headers: { authorization: `Bearer ${sessao.accessToken}` },
      payload: { refreshToken: sessao.refreshToken },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.body).toBe('');

    // Encerrar sessão não pode ser confundido com reuso: o alerta existe para
    // sinalizar credencial vazada, e dispará-lo no logout treinaria quem opera
    // a ignorá-lo.
    const depois = await env.chamar('POST', '/v1/auth/refresh', {
      payload: { refreshToken: sessao.refreshToken },
    });
    expect(depois.statusCode).toBe(401);
    expect(depois.json<Problema>().code).toBe('REFRESH_TOKEN_INVALID');
  }, 60_000);

  it('a jornada exercita todas as rotas documentadas', () => {
    // Uma rota documentada que nenhuma jornada percorre é uma rota que ninguém
    // provou existir de ponta a ponta.
    expect([...documentedRoutes()].sort()).toEqual([...env.rotasChamadas].sort());
  });
});

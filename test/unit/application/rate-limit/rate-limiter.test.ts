import { describe, expect, it } from 'vitest';
import {
  RateLimiter,
  buildRateLimitPolicies,
  rateLimitSubject,
  type RateLimitRule,
} from '../../../../src/application/rate-limit';
import { InMemoryRateLimiterStore } from '../../../../src/infrastructure/persistence/in-memory/in-memory-rate-limiter-store';
import type { RateLimiterStore } from '../../../../src/domain/ports';
import { FixedClock, RecordingLogger } from '../../../support/fakes';

const INICIO = new Date('2026-09-06T12:00:00.000Z');
const MINUTO = 60_000;

const regra: RateLimitRule = { name: 'products.list', limit: 5, windowMs: MINUTO };

interface Cenario {
  readonly limiter: RateLimiter;
  readonly clock: FixedClock;
  readonly logger: RecordingLogger;
}

const montar = (overrides: { store?: RateLimiterStore; failOpen?: boolean } = {}): Cenario => {
  const clock = new FixedClock(INICIO);
  const logger = new RecordingLogger();
  const limiter = new RateLimiter({
    store: overrides.store ?? new InMemoryRateLimiterStore(),
    clock,
    logger,
    failOpen: overrides.failOpen ?? true,
  });

  return { limiter, clock, logger };
};

/** Dispara `vezes` requisições e devolve a decisão de cada uma. */
const bater = async (c: Cenario, vezes: number, sujeito = 'user:1') => {
  const decisoes = [];
  for (let i = 0; i < vezes; i += 1) {
    decisoes.push(await c.limiter.check(regra, sujeito));
  }
  return decisoes;
};

describe('RateLimiter', () => {
  describe('dentro e fora da cota', () => {
    it('libera enquanto o limite não é atingido', async () => {
      const c = montar();

      const decisoes = await bater(c, 5);

      expect(decisoes.every((d) => d.allowed)).toBe(true);
    });

    it('recusa a requisição seguinte ao limite', async () => {
      const c = montar();
      await bater(c, 5);

      const excedente = await c.limiter.check(regra, 'user:1');

      expect(excedente.allowed).toBe(false);
      expect(c.logger.events()).toContain('rate_limit.exceeded');
    });

    it('decrementa o saldo a cada requisição', async () => {
      const c = montar();

      const decisoes = await bater(c, 5);

      expect(decisoes.map((d) => d.remaining)).toEqual([4, 3, 2, 1, 0]);
    });

    it('nunca informa saldo negativo', async () => {
      const c = montar();

      const decisoes = await bater(c, 8);

      expect(decisoes.every((d) => d.remaining >= 0)).toBe(true);
    });
  });

  describe('cabeçalhos da resposta', () => {
    it('informa limite, saldo e renovação também quando libera', async () => {
      const c = montar();

      const decisao = await c.limiter.check(regra, 'user:1');

      expect(decisao.limit).toBe(5);
      expect(decisao.remaining).toBe(4);
      expect(decisao.resetAt).toEqual(new Date(INICIO.getTime() + MINUTO));
    });

    it('informa quantos segundos faltam para a renovação', async () => {
      const c = montar();
      c.clock.advanceMs(20_000);

      const decisao = await c.limiter.check(regra, 'user:1');

      expect(decisao.retryAfterSeconds).toBe(40);
    });

    it('nunca devolve zero segundos, que convidaria a repetir na hora', async () => {
      const c = montar();
      c.clock.advanceMs(MINUTO - 1);

      expect((await c.limiter.check(regra, 'user:1')).retryAfterSeconds).toBe(1);
    });
  });

  describe('a janela desliza, não salta', () => {
    it('não permite o dobro da cota na virada do minuto', async () => {
      // É o defeito da janela fixa: gastar tudo no fim de um minuto e tudo de
      // novo no começo do seguinte passaria o dobro em poucos segundos.
      const c = montar();
      c.clock.advanceMs(MINUTO - 1_000);
      await bater(c, 5);

      c.clock.advanceMs(2_000);
      const logoApos = await c.limiter.check(regra, 'user:1');

      expect(logoApos.allowed).toBe(false);
    });

    it('libera de novo quando a janela anterior já saiu do intervalo', async () => {
      const c = montar();
      await bater(c, 5);

      c.clock.advanceMs(2 * MINUTO);

      expect((await c.limiter.check(regra, 'user:1')).allowed).toBe(true);
    });

    it('a janela anterior perde peso conforme o tempo avança', async () => {
      const c = montar();
      await bater(c, 5);

      // Na metade da janela seguinte, metade da contagem anterior ainda pesa.
      c.clock.advanceMs(MINUTO + MINUTO / 2);
      const meio = await c.limiter.check(regra, 'user:1');

      expect(meio.allowed).toBe(true);
      expect(meio.remaining).toBe(1);
    });

    it('não arrasta contagem depois de um intervalo sem tráfego', async () => {
      // Penalizar alguém por requisições que já saíram do intervalo observado
      // seria pior que não limitar.
      const c = montar();
      await bater(c, 5);

      c.clock.advanceMs(10 * MINUTO);
      const decisao = await c.limiter.check(regra, 'user:1');

      expect(decisao.allowed).toBe(true);
      expect(decisao.remaining).toBe(4);
    });
  });

  describe('Retry-After corresponde ao retorno real da cota', () => {
    const excederEVoltar = async (excesso: number) => {
      const c = montar();
      const produtos: RateLimitRule = { name: 'products.list', limit: 60, windowMs: MINUTO };

      let ultima = await c.limiter.check(produtos, 'user:1');
      for (let i = 1; i < excesso; i += 1) {
        ultima = await c.limiter.check(produtos, 'user:1');
      }

      c.clock.advanceMs(ultima.retryAfterSeconds * 1000);

      return {
        anunciado: ultima.retryAfterSeconds,
        aoVoltar: await c.limiter.check(produtos, 'user:1'),
      };
    };

    it.each([61, 120, 300, 600])(
      'quem excede com %i requisições e espera o anunciado é liberado',
      async (excesso) => {
        // Devolver a borda da janela seria mais simples e estaria errado: a
        // janela anterior entra ponderada na seguinte, então quem excedeu muito
        // continua acima do limite depois da virada. O cliente seria recusado de
        // novo, e a tentativa realimentaria o contador.
        const { aoVoltar } = await excederEVoltar(excesso);

        expect(aoVoltar.allowed).toBe(true);
      },
    );

    it('o tempo anunciado cresce com o tamanho do excesso', async () => {
      const pequeno = await excederEVoltar(61);
      const grande = await excederEVoltar(600);

      expect(grande.anunciado).toBeGreaterThan(pequeno.anunciado);
    });

    it('quem ignora o anunciado e repete no ritmo do limite continua barrado', async () => {
      // Comportamento desejado: o cabeçalho é instrução, e quem não a segue não
      // ganha nada com isso.
      const c = montar();
      const produtos: RateLimitRule = { name: 'products.list', limit: 60, windowMs: MINUTO };
      for (let i = 0; i < 120; i += 1) await c.limiter.check(produtos, 'user:1');

      let liberadas = 0;
      for (let s = 0; s < 90; s += 1) {
        c.clock.advanceMs(1_000);
        if ((await c.limiter.check(produtos, 'user:1')).allowed) liberadas += 1;
      }

      expect(liberadas).toBe(0);
    });
  });

  describe('relógio andando para trás', () => {
    it('não zera a cota de quem está bloqueado', async () => {
      // Ajuste de horário para trás acontece em produção. Adotar a janela
      // recalculada liberaria quem acabou de ser barrado.
      const c = montar();
      c.clock.advanceMs(MINUTO + 1_000);
      await bater(c, 6);

      expect((await c.limiter.check(regra, 'user:1')).allowed).toBe(false);

      c.clock.advanceMs(-2_000);

      expect((await c.limiter.check(regra, 'user:1')).allowed).toBe(false);
    });

    it('não infla a estimativa com peso maior que um', async () => {
      const c = montar();
      c.clock.advanceMs(MINUTO);
      await bater(c, 1);
      c.clock.advanceMs(-5_000);

      const decisao = await c.limiter.check(regra, 'user:1');

      expect(decisao.remaining).toBeLessThanOrEqual(regra.limit);
      expect(decisao.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isolamento das cotas', () => {
    it('usuários diferentes não compartilham cota', async () => {
      const c = montar();
      await bater(c, 5, 'user:1');

      expect((await c.limiter.check(regra, 'user:2')).allowed).toBe(true);
    });

    it('políticas diferentes não compartilham cota para o mesmo sujeito', async () => {
      // Sem o nome da política na chave, gastar o limite do login derrubaria a
      // renovação de sessão do mesmo endereço.
      const c = montar();
      const login: RateLimitRule = { name: 'auth.login', limit: 2, windowMs: MINUTO };
      const refresh: RateLimitRule = { name: 'auth.refresh', limit: 2, windowMs: MINUTO };
      const origem = rateLimitSubject.ip('203.0.113.7');

      await c.limiter.check(login, origem);
      await c.limiter.check(login, origem);

      expect((await c.limiter.check(login, origem)).allowed).toBe(false);
      expect((await c.limiter.check(refresh, origem)).allowed).toBe(true);
    });
  });

  describe('contador indisponível', () => {
    const quebrado: RateLimiterStore = {
      hit: () => Promise.reject(new Error('DynamoDB indisponível')),
    };

    it('deixa passar quando configurado para priorizar disponibilidade', async () => {
      // Falhar fechado transformaria instabilidade do banco em indisponibilidade
      // total, punindo também quem está usando corretamente.
      const c = montar({ store: quebrado, failOpen: true });

      expect((await c.limiter.check(regra, 'user:1')).allowed).toBe(true);
    });

    it('recusa quando configurado para priorizar proteção', async () => {
      const c = montar({ store: quebrado, failOpen: false });

      expect((await c.limiter.check(regra, 'user:1')).allowed).toBe(false);
    });

    it('registra como erro, porque a aplicação ficou sem uma defesa', async () => {
      const c = montar({ store: quebrado });

      await c.limiter.check(regra, 'user:1');

      const registro = c.logger.find('rate_limit.store_error');
      expect(registro?.level).toBe('error');
      expect(registro?.fields.reason).toBe('DynamoDB indisponível');
    });

    it('registra a falha mesmo quando o motivo não é um Error', async () => {
      // Rejeitar com algo que não é Error é exatamente o cenário sob teste:
      // uma biblioteca de terceiros pode fazer isso, e o log não pode quebrar.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const c = montar({ store: { hit: () => Promise.reject('texto solto') } });

      await c.limiter.check(regra, 'user:1');

      expect(c.logger.find('rate_limit.store_error')?.fields.reason).toBe('desconhecido');
    });

    it('informa saldo zero, para o cliente bem-comportado desacelerar', async () => {
      const c = montar({ store: quebrado });

      const decisao = await c.limiter.check(regra, 'user:1');

      expect(decisao.remaining).toBe(0);
      expect(decisao.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('não registra excesso quando o problema foi o contador', async () => {
      const c = montar({ store: quebrado, failOpen: false });

      await c.limiter.check(regra, 'user:1');

      expect(c.logger.events()).not.toContain('rate_limit.exceeded');
    });
  });

  describe('políticas construídas a partir da configuração', () => {
    it('usa os limites informados e janela de um minuto', () => {
      const politicas = buildRateLimitPolicies({
        loginPerMinute: 10,
        refreshPerMinute: 20,
        productsPerMinute: 60,
      });

      expect(politicas.login).toEqual({ name: 'auth.login', limit: 10, windowMs: MINUTO });
      expect(politicas.refresh).toEqual({ name: 'auth.refresh', limit: 20, windowMs: MINUTO });
      expect(politicas.productsList).toEqual({
        name: 'products.list',
        limit: 60,
        windowMs: MINUTO,
      });
    });

    it('identifica o sujeito por usuário ou por origem', () => {
      expect(rateLimitSubject.user('u1')).toBe('user:u1');
      expect(rateLimitSubject.ip('203.0.113.7')).toBe('ip:203.0.113.7');
    });
  });

  describe('critério de aceite da issue', () => {
    it('a 61ª requisição do minuto recebe recusa com Retry-After correto', async () => {
      const c = montar();
      const produtos: RateLimitRule = { name: 'products.list', limit: 60, windowMs: MINUTO };

      for (let i = 0; i < 60; i += 1) {
        const permitida = await c.limiter.check(produtos, 'user:1');
        expect(permitida.allowed).toBe(true);
      }

      const excedente = await c.limiter.check(produtos, 'user:1');

      expect(excedente.allowed).toBe(false);
      expect(excedente.remaining).toBe(0);

      // O anunciado passa da borda do minuto de propósito: a janela anterior
      // ainda pesa no começo da seguinte, e mandar tentar na borda faria o
      // cliente ser recusado outra vez.
      expect(excedente.retryAfterSeconds).toBeGreaterThan(60);

      c.clock.advanceMs(excedente.retryAfterSeconds * 1000);
      expect((await c.limiter.check(produtos, 'user:1')).allowed).toBe(true);
    });
  });
});

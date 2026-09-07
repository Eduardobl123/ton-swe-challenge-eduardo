import { beforeEach, describe, expect, it } from 'vitest';
import { Logout, RefreshSession, SessionIssuer } from '../../../../src/application/session';
import { InvalidRefreshTokenError } from '../../../../src/domain/errors';
import { InMemoryRefreshTokenRepository } from '../../../../src/infrastructure/persistence/in-memory/in-memory-refresh-token-repository';
import {
  FakeSecureTokenGenerator,
  FakeTokenSigner,
  FixedClock,
  RecordingLogger,
  SequentialIdGenerator,
} from '../../../support/fakes';

const AGORA = new Date('2026-09-06T12:00:00.000Z');
const TTL_ACCESS = 900;
const TTL_REFRESH = 604_800;
const DIA = 24 * 60 * 60 * 1_000;

interface Cenario {
  readonly refreshSession: RefreshSession;
  readonly logout: Logout;
  readonly issuer: SessionIssuer;
  readonly refreshTokens: InMemoryRefreshTokenRepository;
  readonly clock: FixedClock;
  readonly logger: RecordingLogger;
}

const montar = (): Cenario => {
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const secureTokens = new FakeSecureTokenGenerator();
  const clock = new FixedClock(AGORA);
  const logger = new RecordingLogger();
  const issuer = new SessionIssuer({
    tokenSigner: new FakeTokenSigner(),
    secureTokens,
    idGenerator: new SequentialIdGenerator(),
    clock,
    accessTokenTtlSeconds: TTL_ACCESS,
    refreshTokenTtlSeconds: TTL_REFRESH,
  });

  return {
    issuer,
    refreshTokens,
    clock,
    logger,
    refreshSession: new RefreshSession({
      refreshTokens,
      secureTokens,
      sessionIssuer: issuer,
      clock,
      logger,
    }),
    logout: new Logout({ refreshTokens, secureTokens, clock, logger }),
  };
};

/** Simula o login: emite a sessão e grava, como faz o caso de uso de autenticação. */
const entrar = async (c: Cenario, userId = 'user-1'): Promise<string> => {
  const sessao = await c.issuer.issue(userId);
  await c.refreshTokens.save(sessao.entity);

  return sessao.refreshToken;
};

const renovar = (c: Cenario, token: string): Promise<{ refreshToken: string }> =>
  c.refreshSession.execute({ refreshToken: token, ipAddress: '203.0.113.7' });

describe('RefreshSession', () => {
  let c: Cenario;

  beforeEach(() => {
    c = montar();
  });

  describe('rotação', () => {
    it('emite um par novo', async () => {
      const original = await entrar(c);

      const saida = await c.refreshSession.execute({
        refreshToken: original,
        ipAddress: undefined,
      });

      expect(saida.accessToken).toBe('token-for:user-1');
      expect(saida.refreshToken).not.toBe(original);
      expect(saida.tokenType).toBe('Bearer');
      expect(saida.expiresIn).toBe(TTL_ACCESS);
    });

    it('o token anterior deixa de funcionar', async () => {
      const original = await entrar(c);
      await renovar(c, original);

      await expect(renovar(c, original)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('o token novo funciona', async () => {
      const original = await entrar(c);
      const { refreshToken: novo } = await renovar(c, original);

      await expect(renovar(c, novo)).resolves.toBeDefined();
    });

    it('mantém a família ao longo da linhagem', async () => {
      const original = await entrar(c);
      await renovar(c, original);

      const familias = c.logger.records
        .filter((r) => r.event === 'auth.refresh.succeeded')
        .map((r) => r.fields.familyId);

      expect(familias).toEqual(['id-0002']);
    });

    it('renova várias vezes seguidas', async () => {
      let token = await entrar(c);

      for (let i = 0; i < 5; i += 1) {
        token = (await renovar(c, token)).refreshToken;
      }

      await expect(renovar(c, token)).resolves.toBeDefined();
    });
  });

  describe('detecção de reuso', () => {
    it('reapresentar um token gasto derruba a família inteira', async () => {
      // Não há como saber qual das partes é legítima: as duas têm a mesma
      // credencial. Entre manter uma sessão possivelmente comprometida e exigir
      // nova autenticação, a segunda é a correta.
      const original = await entrar(c);
      const { refreshToken: novo } = await renovar(c, original);

      await expect(renovar(c, original)).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // O token legítimo emitido na renovação também morre.
      await expect(renovar(c, novo)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('registra o incidente como erro, com usuário e família', async () => {
      const original = await entrar(c);
      await renovar(c, original);
      await renovar(c, original).catch(() => undefined);

      const incidente = c.logger.find('auth.refresh.reuse_detected');
      expect(incidente?.level).toBe('error');
      expect(incidente?.fields.userId).toBe('user-1');
      expect(incidente?.fields.familyId).toBe('id-0002');
    });

    it('não avisa ao cliente que o reuso foi percebido', async () => {
      const original = await entrar(c);
      await renovar(c, original);

      const erro = await renovar(c, original).catch((e: Error) => e);

      expect((erro as Error).message).toBe('Refresh token inválido ou expirado.');
      expect((erro as Error).message).not.toMatch(/reuso|família|revogad/i);
    });

    it('não derruba a sessão de outro usuário', async () => {
      const primeiro = await entrar(c, 'user-1');
      const segundo = await entrar(c, 'user-2');
      await renovar(c, primeiro);
      await renovar(c, primeiro).catch(() => undefined);

      await expect(renovar(c, segundo)).resolves.toBeDefined();
    });

    it('renovações simultâneas com o mesmo token: só uma vence', async () => {
      // A rotação atômica é o que sustenta a detecção. Se as duas passassem, a
      // cópia roubada seria tão válida quanto a legítima.
      const original = await entrar(c);

      const resultados = await Promise.allSettled([renovar(c, original), renovar(c, original)]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });
  });

  describe('sessão encerrada não é reuso', () => {
    it('renovar depois do logout recusa sem alerta de segurança', async () => {
      // Logout é evento cotidiano. Tratá-lo como reuso encheria o alerta de
      // ruído até ninguém mais olhar para ele.
      const token = await entrar(c);
      await c.logout.execute({ refreshToken: token, ipAddress: undefined });

      await expect(renovar(c, token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      expect(c.logger.find('auth.refresh.reuse_detected')).toBeUndefined();
      expect(c.logger.find('auth.refresh.failed')?.fields.reason).toBe('session_ended');
    });

    it('token derrubado junto com a família também não alerta', async () => {
      const original = await entrar(c);
      const { refreshToken: novo } = await renovar(c, original);
      await c.logout.execute({ refreshToken: novo, ipAddress: undefined });
      const antes = c.logger.records.length;

      await renovar(c, novo).catch(() => undefined);

      const novosAlertas = c.logger.records
        .slice(antes)
        .filter((r) => r.event === 'auth.refresh.reuse_detected');
      expect(novosAlertas).toHaveLength(0);
    });

    it('reuso de verdade continua alertando', async () => {
      const original = await entrar(c);
      await renovar(c, original);

      await renovar(c, original).catch(() => undefined);

      expect(c.logger.find('auth.refresh.reuse_detected')?.level).toBe('error');
    });

    it('insistir com o token roubado não revoga a família de novo', async () => {
      // Repetir a varredura da família a cada tentativa daria a quem ataca uma
      // forma barata de gerar carga no banco.
      const original = await entrar(c);
      await renovar(c, original);

      let revogacoes = 0;
      const contando = new RefreshSession({
        refreshTokens: {
          findByHash: (h) => c.refreshTokens.findByHash(h),
          save: (t) => c.refreshTokens.save(t),
          rotate: (a, b) => c.refreshTokens.rotate(a, b),
          revokeFamily: (f, n) => {
            revogacoes += 1;
            return c.refreshTokens.revokeFamily(f, n);
          },
        },
        secureTokens: new FakeSecureTokenGenerator(),
        sessionIssuer: c.issuer,
        clock: c.clock,
        logger: c.logger,
      });

      for (let i = 0; i < 5; i += 1) {
        await contando
          .execute({ refreshToken: original, ipAddress: undefined })
          .catch(() => undefined);
      }

      expect(revogacoes).toBe(1);
      // O alerta, esse sim, se repete: cada tentativa é um dado sobre o ataque.
      expect(
        c.logger.records.filter((r) => r.event === 'auth.refresh.reuse_detected'),
      ).toHaveLength(5);
    });
  });

  describe('recusa', () => {
    it('token desconhecido', async () => {
      await expect(renovar(c, 'nunca-emitido')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(c.logger.find('auth.refresh.failed')?.fields.reason).toBe('unknown_token');
    });

    it('token expirado', async () => {
      // Decidido pelo domínio, e não pela ausência do registro: o TTL do
      // DynamoDB remove itens com atraso de até 48 horas.
      const original = await entrar(c);
      c.clock.advanceMs(8 * DIA);

      await expect(renovar(c, original)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(c.logger.find('auth.refresh.failed')?.fields.reason).toBe('expired');
    });

    it('token ainda válido às vésperas da expiração', async () => {
      const original = await entrar(c);
      c.clock.advanceMs(TTL_REFRESH * 1000 - 1);

      await expect(renovar(c, original)).resolves.toBeDefined();
    });

    it('todos os motivos produzem a mesma mensagem', async () => {
      const original = await entrar(c);
      await renovar(c, original);

      const mensagens = await Promise.all([
        renovar(c, 'nunca-emitido').catch((e: Error) => e.message),
        renovar(c, original).catch((e: Error) => e.message),
      ]);

      expect(new Set(mensagens).size).toBe(1);
    });
  });

  describe('falhas de infraestrutura', () => {
    it('propaga erro da rotação que não seja concorrência', async () => {
      // Perder a corrida é tratado como reuso; o banco fora do ar não é, e
      // disfarçá-lo de credencial inválida esconderia um incidente real.
      const original = await entrar(c);
      const quebrado = new InMemoryRefreshTokenRepository();
      await quebrado.save((await c.issuer.issue('user-1')).entity);

      const comFalha = new RefreshSession({
        refreshTokens: {
          findByHash: () => c.refreshTokens.findByHash(`sha256:${original}`),
          save: () => Promise.resolve(undefined),
          rotate: () => Promise.reject(new Error('DynamoDB indisponível')),
          revokeFamily: () => Promise.resolve(undefined),
        },
        secureTokens: new FakeSecureTokenGenerator(),
        sessionIssuer: c.issuer,
        clock: c.clock,
        logger: c.logger,
      });

      await expect(
        comFalha.execute({ refreshToken: original, ipAddress: undefined }),
      ).rejects.toThrow('DynamoDB indisponível');
    });
  });

  describe('o que nunca pode aparecer no log', () => {
    it('não registra o valor do refresh token em nenhum caminho', async () => {
      const original = await entrar(c);
      const { refreshToken: novo } = await renovar(c, original);
      await renovar(c, original).catch(() => undefined);
      await renovar(c, 'nunca-emitido').catch(() => undefined);

      const registrado = c.logger.dump();
      expect(registrado).not.toContain(original);
      expect(registrado).not.toContain(novo);
      expect(registrado).not.toContain('sha256:');
    });
  });
});

describe('Logout', () => {
  it('revoga a família, invalidando a renovação', async () => {
    const c = montar();
    const token = await entrar(c);

    await c.logout.execute({ refreshToken: token, ipAddress: undefined });

    await expect(renovar(c, token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('derruba também os tokens anteriores da mesma linhagem', async () => {
    const c = montar();
    const original = await entrar(c);
    const { refreshToken: novo } = await renovar(c, original);

    await c.logout.execute({ refreshToken: novo, ipAddress: undefined });

    await expect(renovar(c, novo)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('não derruba a sessão de outro login do mesmo usuário', async () => {
    // Cada login inicia família própria, então sair de um dispositivo não
    // desconecta os outros.
    const c = montar();
    const primeira = await entrar(c, 'user-1');
    const segunda = await entrar(c, 'user-1');

    await c.logout.execute({ refreshToken: primeira, ipAddress: undefined });

    await expect(renovar(c, segunda)).resolves.toBeDefined();
  });

  it('não falha com token desconhecido', async () => {
    // Sair é intenção que o cliente já cumpriu ao descartar a credencial;
    // devolver erro só atrapalharia, e distinguir os casos informaria se um
    // token existe a quem só quer descobrir isso.
    const c = montar();

    await expect(
      c.logout.execute({ refreshToken: 'nunca-emitido', ipAddress: undefined }),
    ).resolves.toBeUndefined();
    expect(c.logger.events()).toContain('auth.logout.unknown_token');
  });

  it('é idempotente', async () => {
    const c = montar();
    const token = await entrar(c);

    await c.logout.execute({ refreshToken: token, ipAddress: undefined });

    await expect(
      c.logout.execute({ refreshToken: token, ipAddress: undefined }),
    ).resolves.toBeUndefined();
  });

  it('não registra o valor do token', async () => {
    const c = montar();
    const token = await entrar(c);

    await c.logout.execute({ refreshToken: token, ipAddress: undefined });

    expect(c.logger.dump()).not.toContain(token);
  });
});

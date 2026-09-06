import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticateUser } from '../../../../src/application/use-cases';
import { User } from '../../../../src/domain/entities';
import { ConcurrencyError, InvalidCredentialsError } from '../../../../src/domain/errors';
import { Email, LockoutPolicy, PasswordHash } from '../../../../src/domain/value-objects';
import type { UserRepository } from '../../../../src/domain/ports';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/in-memory/in-memory-user-repository';
import {
  FakePasswordHasher,
  FakeTokenSigner,
  FixedClock,
  RecordingLogger,
} from '../../../support/fakes';

const AGORA = new Date('2026-09-06T12:00:00.000Z');
const SENHA = 'Desafio@Ton2026';
const EMAIL = 'maria@ton.com.br';
const TTL = 900;
const SEGUNDO = 1_000;

const INERTE = PasswordHash.create('hashed:$$-nenhuma-senha-corresponde-$$');

const lockoutPolicy = LockoutPolicy.create({
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 900_000,
});

const usuarioDemo = (): User =>
  User.create({
    id: 'user-1',
    email: Email.create(EMAIL),
    passwordHash: PasswordHash.create(`hashed:${SENHA}`),
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    createdAt: AGORA,
    version: 1,
  });

interface Cenario {
  readonly useCase: AuthenticateUser;
  readonly users: UserRepository;
  readonly hasher: FakePasswordHasher;
  readonly signer: FakeTokenSigner;
  readonly logger: RecordingLogger;
  readonly clock: FixedClock;
}

const montar = (overrides: { users?: UserRepository } = {}): Cenario => {
  const users = overrides.users ?? new InMemoryUserRepository([usuarioDemo()]);
  const hasher = new FakePasswordHasher();
  const signer = new FakeTokenSigner();
  const logger = new RecordingLogger();
  const clock = new FixedClock(AGORA);

  return {
    users,
    hasher,
    signer,
    logger,
    clock,
    useCase: new AuthenticateUser({
      users,
      passwordHasher: hasher,
      tokenSigner: signer,
      clock,
      logger,
      lockoutPolicy,
      accessTokenTtlSeconds: TTL,
      inertPasswordHash: INERTE,
    }),
  };
};

const entrar = (c: Cenario, email = EMAIL, password = SENHA): Promise<unknown> =>
  c.useCase.execute({ email, password, ipAddress: '203.0.113.7' });

describe('AuthenticateUser', () => {
  let c: Cenario;

  beforeEach(() => {
    c = montar();
  });

  describe('autenticação bem-sucedida', () => {
    it('emite um access token para o usuário correto', async () => {
      const saida = await c.useCase.execute({
        email: EMAIL,
        password: SENHA,
        ipAddress: undefined,
      });

      expect(saida.userId).toBe('user-1');
      expect(saida.tokenType).toBe('Bearer');
      expect(saida.expiresIn).toBe(TTL);
      await expect(c.signer.verify(saida.accessToken)).resolves.toMatchObject({ sub: 'user-1' });
    });

    it('assina com a validade configurada', async () => {
      await entrar(c);

      expect(c.signer.signed).toEqual([{ subject: 'user-1', ttlSeconds: TTL }]);
    });

    it('aceita o e-mail em qualquer caixa', async () => {
      await expect(entrar(c, 'MARIA@TON.COM.BR')).resolves.toBeDefined();
    });

    it('registra o sucesso sem emitir falha', async () => {
      await entrar(c);

      expect(c.logger.events()).toContain('auth.login.succeeded');
      expect(c.logger.events()).not.toContain('auth.login.failed');
    });
  });

  describe('resposta indistinguível entre os motivos de recusa', () => {
    // O núcleo do ADR 0010: quatro caminhos diferentes, uma resposta só.
    it.each([
      ['e-mail inexistente', 'ninguem@ton.com.br', SENHA],
      ['senha errada', EMAIL, 'senha-errada'],
      ['e-mail malformado', 'nao-e-email', SENHA],
    ])('recusa %s com o mesmo erro', async (_caso, email, password) => {
      await expect(entrar(c, email, password)).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('produz corpo idêntico para e-mail inexistente e senha errada', async () => {
      const inexistente = await entrar(c, 'ninguem@ton.com.br').catch((e: Error) => e);
      const senhaErrada = await entrar(c, EMAIL, 'errada').catch((e: Error) => e);

      expect((inexistente as InvalidCredentialsError).code).toBe(
        (senhaErrada as InvalidCredentialsError).code,
      );
      expect((inexistente as Error).message).toBe((senhaErrada as Error).message);
      expect((inexistente as InvalidCredentialsError).details).toEqual(
        (senhaErrada as InvalidCredentialsError).details,
      );
    });

    it('gasta uma verificação de hash mesmo sem usuário para verificar', async () => {
      // Sem isto, a resposta para um e-mail inexistente voltaria mais rápido, e
      // a diferença de tempo revelaria quais contas existem.
      await entrar(c, 'ninguem@ton.com.br').catch(() => undefined);

      expect(c.hasher.verifications).toHaveLength(1);
      expect(c.hasher.verifications[0]?.hash).toBe(INERTE.value);
    });

    it('gasta uma verificação de hash também quando o e-mail é malformado', async () => {
      await entrar(c, 'nao-e-email').catch(() => undefined);

      expect(c.hasher.verifications).toHaveLength(1);
    });
  });

  describe('bloqueio progressivo', () => {
    const errarVezes = async (vezes: number): Promise<void> => {
      for (let i = 0; i < vezes; i += 1) {
        await entrar(c, EMAIL, 'errada').catch(() => undefined);
      }
    };

    it('conta as tentativas malsucedidas', async () => {
      await errarVezes(3);

      expect(c.logger.find('auth.login.failed')?.fields.reason).toBe('wrong_password');
      const usuario = await c.users.findByEmail(Email.create(EMAIL));
      expect(usuario?.failedLoginAttempts).toBe(3);
    });

    it('bloqueia a conta após o limite de falhas', async () => {
      await errarVezes(5);

      const usuario = await c.users.findByEmail(Email.create(EMAIL));
      expect(usuario?.isLocked(AGORA)).toBe(true);
    });

    it('recusa a senha correta enquanto bloqueado, com a resposta genérica', async () => {
      await errarVezes(5);

      await expect(entrar(c)).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(c.logger.events()).toContain('auth.login.locked');
    });

    it('não gasta argon2 verificando a senha de uma conta bloqueada', async () => {
      await errarVezes(5);
      const antes = c.hasher.verifications.length;

      await entrar(c).catch(() => undefined);

      // Uma única chamada, e contra o hash inerte: equaliza o tempo sem pagar a
      // derivação real de uma conta que não vai autenticar de todo jeito.
      const novas = c.hasher.verifications.slice(antes);
      expect(novas).toHaveLength(1);
      expect(novas[0]?.hash).toBe(INERTE.value);
    });

    it('autentica de novo depois que o bloqueio expira', async () => {
      await errarVezes(5);
      c.clock.advanceMs(31 * SEGUNDO);

      await expect(entrar(c)).resolves.toBeDefined();
    });

    it('zera o contador após um login bem-sucedido', async () => {
      await errarVezes(3);
      c.clock.advanceMs(SEGUNDO);
      await entrar(c);

      const usuario = await c.users.findByEmail(Email.create(EMAIL));
      expect(usuario?.failedLoginAttempts).toBe(0);
    });
  });

  describe('senha longa demais', () => {
    it('recusa antes de chegar ao hasher', async () => {
      // Um corpo de dezenas de kilobytes não pode custar uma derivação argon2.
      await expect(entrar(c, EMAIL, 'a'.repeat(129))).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
      expect(c.hasher.verifications).toHaveLength(0);
      expect(c.logger.events()).toContain('auth.login.password_too_long');
    });

    it('aceita senha no limite de 128 caracteres', async () => {
      await entrar(c, EMAIL, 'a'.repeat(128)).catch(() => undefined);

      expect(c.hasher.verifications).toHaveLength(1);
    });
  });

  describe('concorrência', () => {
    it('bloqueia a conta mesmo com as tentativas disparadas em paralelo', async () => {
      // Regressão do achado P1 da revisão. Contar do lado do caso de uso fazia
      // cem tentativas simultâneas valerem por uma, e o bloqueio deixava de
      // existir contra ataque automatizado.
      await Promise.all(
        Array.from({ length: 100 }, () =>
          c.useCase
            .execute({ email: EMAIL, password: 'errada', ipAddress: undefined })
            .catch(() => undefined),
        ),
      );

      const usuario = await c.users.findByEmail(Email.create(EMAIL));
      expect(usuario?.failedLoginAttempts).toBeGreaterThanOrEqual(5);
      expect(usuario?.isLocked(AGORA)).toBe(true);
    });

    it('emite auth.login.failed em toda tentativa malsucedida', async () => {
      // Sem isso, um alerta baseado nesse evento ficaria cego justamente durante
      // um ataque concorrente.
      await Promise.all(
        Array.from({ length: 4 }, () =>
          c.useCase
            .execute({ email: EMAIL, password: 'errada', ipAddress: undefined })
            .catch(() => undefined),
        ),
      );

      const falhas = c.logger.records.filter((r) => r.event === 'auth.login.failed');
      expect(falhas).toHaveLength(4);
    });

    it('conclui o login quando o conflito ocorre ao zerar o contador', async () => {
      // A senha estava correta: recusar por causa de uma corrida de escrituração
      // puniria quem acertou a credencial.
      const users: UserRepository = {
        findByEmail: () =>
          Promise.resolve(User.create({ ...usuarioDemo().toProps(), failedLoginAttempts: 2 })),
        registerFailedLogin: () => Promise.reject(new Error('não usado')),
        save: () => Promise.reject(new ConcurrencyError('User', 'user-1')),
      };
      const cenario = montar({ users });

      await expect(
        cenario.useCase.execute({ email: EMAIL, password: SENHA, ipAddress: undefined }),
      ).resolves.toBeDefined();
      expect(cenario.logger.events()).toContain('auth.login.reset_conflict');
    });

    it('propaga falha de persistência que não seja concorrência no caminho de sucesso', async () => {
      // Perder a escrita por concorrência é tolerável; o banco fora do ar não é.
      const users: UserRepository = {
        findByEmail: () =>
          Promise.resolve(User.create({ ...usuarioDemo().toProps(), failedLoginAttempts: 2 })),
        registerFailedLogin: () => Promise.reject(new Error('não usado')),
        save: () => Promise.reject(new Error('DynamoDB indisponível')),
      };
      const cenario = montar({ users });

      await expect(
        cenario.useCase.execute({ email: EMAIL, password: SENHA, ipAddress: undefined }),
      ).rejects.toThrow('DynamoDB indisponível');
    });

    it('propaga falha do contador de tentativas', async () => {
      const users: UserRepository = {
        findByEmail: () => Promise.resolve(usuarioDemo()),
        registerFailedLogin: () => Promise.reject(new Error('DynamoDB indisponível')),
        save: () => Promise.resolve(undefined),
      };
      const cenario = montar({ users });

      await expect(
        cenario.useCase.execute({ email: EMAIL, password: 'errada', ipAddress: undefined }),
      ).rejects.toThrow('DynamoDB indisponível');
    });
  });

  describe('erros inesperados', () => {
    it('não disfarça de credencial inválida uma falha imprevista ao normalizar o e-mail', async () => {
      // O `catch` do caso de uso trata apenas erro de validação. Qualquer outra
      // falha precisa subir: transformá-la em 401 esconderia um defeito real
      // atrás de uma resposta plausível.
      vi.spyOn(Email, 'create').mockImplementationOnce(() => {
        throw new TypeError('falha inesperada');
      });

      await expect(entrar(c)).rejects.toThrow(TypeError);
    });
  });

  describe('o que nunca pode aparecer no log', () => {
    it('não registra a senha nem o hash em nenhum caminho', async () => {
      await entrar(c);
      await entrar(c, EMAIL, 'errada').catch(() => undefined);
      await entrar(c, 'ninguem@ton.com.br').catch(() => undefined);
      await entrar(c, EMAIL, 'a'.repeat(200)).catch(() => undefined);

      const registrado = c.logger.dump();
      expect(registrado).not.toContain(SENHA);
      expect(registrado).not.toContain('hashed:');
      expect(registrado).not.toMatch(/password"\s*:\s*"[^"]/);
    });

    it('não registra o e-mail, apenas o identificador do usuário', async () => {
      await entrar(c);

      expect(c.logger.dump()).not.toContain(EMAIL);
      expect(c.logger.find('auth.login.succeeded')?.fields.userId).toBe('user-1');
    });
  });
});

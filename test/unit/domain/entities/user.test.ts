import { describe, expect, it } from 'vitest';
import { User, type UserProps } from '../../../../src/domain/entities';
import { Email, LockoutPolicy, PasswordHash } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

const AGORA = new Date('2026-09-06T12:00:00.000Z');
const SEGUNDO = 1_000;

const policy = LockoutPolicy.create({
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 900_000,
});

const criarUsuario = (overrides: Partial<UserProps> = {}): User =>
  User.create({
    id: 'user-1',
    email: Email.create('maria@ton.com.br'),
    passwordHash: PasswordHash.create('$argon2id$hash'),
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    createdAt: AGORA,
    version: 1,
    ...overrides,
  });

/** Aplica N falhas seguidas, como aconteceria em tentativas reais. */
const falharVezes = (usuario: User, vezes: number, momento = AGORA): User => {
  let atual = usuario;
  for (let i = 0; i < vezes; i += 1) {
    atual = atual.recordFailedLogin(momento, policy);
  }
  return atual;
};

describe('User', () => {
  describe('invariantes', () => {
    it.each([
      ['id vazio', { id: '  ' }],
      ['contador negativo', { failedLoginAttempts: -1 }],
      ['contador fracionário', { failedLoginAttempts: 1.5 }],
      ['versão negativa', { version: -1 }],
      ['versão fracionária', { version: 1.5 }],
    ])('recusa %s', (_caso, overrides) => {
      expect(() => criarUsuario(overrides)).toThrow(ValidationError);
    });
  });

  describe('imutabilidade', () => {
    it('não deixa alterar o bloqueio pela data devolvida no getter', () => {
      // Recuar o lockedUntil destrancaria uma conta que deve seguir bloqueada.
      const usuario = criarUsuario({ lockedUntil: new Date(AGORA.getTime() + 30 * SEGUNDO) });

      usuario.lockedUntil?.setTime(AGORA.getTime() - 1);

      expect(usuario.isLocked(AGORA)).toBe(true);
    });

    it('não deixa alterar a criação pela data devolvida no getter', () => {
      const usuario = criarUsuario();

      usuario.createdAt.setFullYear(1999);

      expect(usuario.createdAt).toEqual(AGORA);
    });

    it('não guarda a referência da data recebida na construção', () => {
      const bloqueio = new Date(AGORA.getTime() + 30 * SEGUNDO);
      const usuario = criarUsuario({ lockedUntil: bloqueio });

      bloqueio.setTime(AGORA.getTime() - 1);

      expect(usuario.isLocked(AGORA)).toBe(true);
    });
  });

  describe('isLocked', () => {
    it('não está bloqueado quando nunca houve bloqueio', () => {
      expect(criarUsuario().isLocked(AGORA)).toBe(false);
    });

    it('está bloqueado enquanto o instante limite não chegou', () => {
      const usuario = criarUsuario({ lockedUntil: new Date(AGORA.getTime() + 30 * SEGUNDO) });

      expect(usuario.isLocked(AGORA)).toBe(true);
    });

    it('deixa de estar bloqueado no instante exato do limite', () => {
      const limite = new Date(AGORA.getTime() + 30 * SEGUNDO);
      const usuario = criarUsuario({ lockedUntil: limite });

      expect(usuario.isLocked(limite)).toBe(false);
    });

    it('deixa de estar bloqueado depois do limite', () => {
      const usuario = criarUsuario({ lockedUntil: new Date(AGORA.getTime() + 30 * SEGUNDO) });

      expect(usuario.isLocked(new Date(AGORA.getTime() + 31 * SEGUNDO))).toBe(false);
    });
  });

  describe('recordFailedLogin', () => {
    it('incrementa o contador', () => {
      expect(criarUsuario().recordFailedLogin(AGORA, policy).failedLoginAttempts).toBe(1);
    });

    it('não bloqueia antes de atingir o limite', () => {
      const usuario = falharVezes(criarUsuario(), 4);

      expect(usuario.failedLoginAttempts).toBe(4);
      expect(usuario.lockedUntil).toBeUndefined();
      expect(usuario.isLocked(AGORA)).toBe(false);
    });

    it('bloqueia ao atingir o limite, pela duração base', () => {
      const usuario = falharVezes(criarUsuario(), 5);

      expect(usuario.isLocked(AGORA)).toBe(true);
      expect(usuario.lockedUntil).toEqual(new Date(AGORA.getTime() + 30 * SEGUNDO));
    });

    it('escala o bloqueio a cada nova falha', () => {
      const seis = falharVezes(criarUsuario(), 6);
      const sete = falharVezes(criarUsuario(), 7);

      expect(seis.lockedUntil).toEqual(new Date(AGORA.getTime() + 60 * SEGUNDO));
      expect(sete.lockedUntil).toEqual(new Date(AGORA.getTime() + 120 * SEGUNDO));
    });

    it('conta a partir do instante da falha, não da primeira tentativa', () => {
      const depois = new Date(AGORA.getTime() + 3600 * SEGUNDO);
      const usuario = falharVezes(criarUsuario(), 4).recordFailedLogin(depois, policy);

      expect(usuario.lockedUntil).toEqual(new Date(depois.getTime() + 30 * SEGUNDO));
    });

    it('mantém o contador quando um bloqueio expira', () => {
      // Zerar ao expirar deixaria quem ataca voltar ao ritmo inicial para sempre,
      // sem nunca escalar a punição.
      const bloqueado = falharVezes(criarUsuario(), 5);
      const depoisDoBloqueio = new Date(AGORA.getTime() + 31 * SEGUNDO);
      const novaFalha = bloqueado.recordFailedLogin(depoisDoBloqueio, policy);

      expect(novaFalha.failedLoginAttempts).toBe(6);
      expect(novaFalha.lockedUntil).toEqual(new Date(depoisDoBloqueio.getTime() + 60 * SEGUNDO));
    });

    it('preserva o bloqueio vigente quando a política deixa de exigir um novo', () => {
      // Cenário real: operação aumenta LOCKOUT_MAX_ATTEMPTS e reimplanta. Uma
      // tentativa malsucedida nunca deve reduzir a proteção da conta.
      const frouxa = LockoutPolicy.create({
        maxAttempts: 10,
        baseDelayMs: 30_000,
        maxDelayMs: 900_000,
      });
      const bloqueado = falharVezes(criarUsuario(), 5);

      const depois = bloqueado.recordFailedLogin(AGORA, frouxa);

      expect(depois.failedLoginAttempts).toBe(6);
      expect(depois.isLocked(AGORA)).toBe(true);
      expect(depois.lockedUntil).toEqual(bloqueado.lockedUntil);
    });

    it('não encurta um bloqueio mais longo já vigente', () => {
      // O caso que a issue #24 descreve: duas tentativas simultâneas cruzam o
      // limiar, a que contou mais falhas grava um bloqueio maior, e a outra
      // chega depois calculando um menor. Tomar o instante mais distante faz o
      // resultado independer da ordem de chegada.
      const bloqueioLongo = new Date(AGORA.getTime() + 300 * SEGUNDO);
      const usuario = criarUsuario({ failedLoginAttempts: 4, lockedUntil: bloqueioLongo });

      const depois = usuario.recordFailedLogin(AGORA, policy);

      // A política pediria apenas 30s para a quinta falha.
      expect(depois.failedLoginAttempts).toBe(5);
      expect(depois.lockedUntil).toEqual(bloqueioLongo);
    });

    it('avança o bloqueio quando o novo é mais longo que o vigente', () => {
      const bloqueioCurto = new Date(AGORA.getTime() + 10 * SEGUNDO);
      const usuario = criarUsuario({ failedLoginAttempts: 4, lockedUntil: bloqueioCurto });

      const depois = usuario.recordFailedLogin(AGORA, policy);

      expect(depois.lockedUntil).toEqual(new Date(AGORA.getTime() + 30 * SEGUNDO));
    });

    it('não altera a instância original', () => {
      const original = criarUsuario();
      original.recordFailedLogin(AGORA, policy);

      expect(original.failedLoginAttempts).toBe(0);
    });

    it('não mexe na versão, que pertence à persistência', () => {
      expect(criarUsuario({ version: 7 }).recordFailedLogin(AGORA, policy).version).toBe(7);
    });
  });

  describe('recordSuccessfulLogin', () => {
    it('zera contador e bloqueio', () => {
      const usuario = falharVezes(criarUsuario(), 6).recordSuccessfulLogin();

      expect(usuario.failedLoginAttempts).toBe(0);
      expect(usuario.lockedUntil).toBeUndefined();
      expect(usuario.isLocked(AGORA)).toBe(false);
    });

    it('devolve a mesma instância quando não havia o que limpar', () => {
      // Evita uma escrita desnecessária no banco a cada login bem-sucedido.
      const usuario = criarUsuario();

      expect(usuario.recordSuccessfulLogin()).toBe(usuario);
    });

    it('devolve instância nova quando havia falhas acumuladas', () => {
      const usuario = falharVezes(criarUsuario(), 1);

      expect(usuario.recordSuccessfulLogin()).not.toBe(usuario);
    });

    it('preserva identidade e credencial', () => {
      const usuario = falharVezes(criarUsuario(), 3).recordSuccessfulLogin();

      expect(usuario.id).toBe('user-1');
      expect(usuario.email.value).toBe('maria@ton.com.br');
      expect(usuario.passwordHash.value).toBe('$argon2id$hash');
      expect(usuario.createdAt).toEqual(AGORA);
    });
  });

  describe('toProps', () => {
    it('devolve uma cópia, não a estrutura interna', () => {
      const usuario = criarUsuario();
      const props = usuario.toProps();
      const mutavel = props as { failedLoginAttempts: number };
      mutavel.failedLoginAttempts = 99;

      expect(usuario.failedLoginAttempts).toBe(0);
    });

    it('devolve datas copiadas, não referências ao estado interno', () => {
      // `Date` é mutável: sem cópia, quem recebe as props altera a entidade.
      const usuario = criarUsuario({ lockedUntil: new Date(AGORA.getTime() + 30 * SEGUNDO) });
      const props = usuario.toProps();

      props.createdAt.setFullYear(1999);
      props.lockedUntil?.setTime(0);

      expect(usuario.createdAt).toEqual(AGORA);
      expect(usuario.isLocked(AGORA)).toBe(true);
    });

    it('carrega todos os campos que a persistência precisa', () => {
      expect(Object.keys(criarUsuario().toProps()).sort()).toEqual([
        'createdAt',
        'email',
        'failedLoginAttempts',
        'id',
        'lockedUntil',
        'passwordHash',
        'version',
      ]);
    });
  });
});

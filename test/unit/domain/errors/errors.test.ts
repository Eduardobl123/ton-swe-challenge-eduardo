import { describe, expect, it } from 'vitest';
import {
  AccountLockedError,
  AppError,
  ConcurrencyError,
  DomainError,
  ERROR_CODES,
  InvalidCredentialsError,
  InvalidCursorError,
  InvalidRefreshTokenError,
  RefreshTokenReuseDetectedError,
  ValidationError,
} from '../../../../src/domain/errors';
import { RateLimitExceededError } from '../../../../src/application/errors';

const AGORA = new Date('2026-09-06T12:00:00.000Z');

const todos = (): AppError[] => [
  new ValidationError('email', 'inválido'),
  new InvalidCursorError(),
  new InvalidCredentialsError(),
  new AccountLockedError(AGORA),
  new InvalidRefreshTokenError(),
  new RefreshTokenReuseDetectedError('user-1', 'fam-1'),
  new ConcurrencyError('User', 'user-1'),
  new RateLimitExceededError(AGORA, 60),
];

describe('erros da aplicação', () => {
  it('todos estendem AppError e Error', () => {
    for (const erro of todos()) {
      expect(erro).toBeInstanceOf(AppError);
      expect(erro).toBeInstanceOf(Error);
    }
  });

  it('todos carregam um código do registro central', () => {
    for (const erro of todos()) {
      expect(ERROR_CODES).toContain(erro.code);
    }
  });

  it('não há código repetido entre classes distintas', () => {
    const codigos = todos().map((erro) => erro.code);

    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('o registro central não tem duplicatas', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('todos expõem o nome da própria classe', () => {
    expect(new InvalidCredentialsError().name).toBe('InvalidCredentialsError');
    expect(new ConcurrencyError('User', 'x').name).toBe('ConcurrencyError');
  });

  describe('separação entre regra de negócio e infraestrutura', () => {
    it('erros de regra de negócio estendem DomainError', () => {
      expect(new InvalidCredentialsError()).toBeInstanceOf(DomainError);
      expect(new ValidationError('x', 'y')).toBeInstanceOf(DomainError);
      expect(new InvalidRefreshTokenError()).toBeInstanceOf(DomainError);
    });

    it('concorrência não é regra de negócio', () => {
      // É a persistência avisando que o estado mudou embaixo.
      expect(new ConcurrencyError('User', 'x')).not.toBeInstanceOf(DomainError);
    });

    it('rate limit não é regra de negócio e vive na camada de aplicação', () => {
      expect(new RateLimitExceededError(AGORA, 60)).not.toBeInstanceOf(DomainError);
    });
  });

  describe('respostas deliberadamente vagas', () => {
    it('credenciais inválidas não dizem se o e-mail existe', () => {
      const mensagem = new InvalidCredentialsError().message;

      expect(mensagem).not.toMatch(/e-mail|senha|usuário|bloque/i);
    });

    it('refresh token inválido não distingue inexistente de expirado', () => {
      expect(new InvalidRefreshTokenError().message).toBe('Refresh token inválido ou expirado.');
    });
  });

  describe('contexto para log', () => {
    it('validação registra o campo que falhou', () => {
      const erro = new ValidationError('email', 'formato inválido');

      expect(erro.field).toBe('email');
      expect(erro.details).toEqual({ field: 'email' });
    });

    it('bloqueio registra até quando vale', () => {
      const erro = new AccountLockedError(AGORA);

      expect(erro.lockedUntil).toEqual(AGORA);
      expect(erro.details).toEqual({ lockedUntil: AGORA.toISOString() });
    });

    it('reuso registra usuário e família, nunca o token', () => {
      const erro = new RefreshTokenReuseDetectedError('user-1', 'fam-1');

      expect(erro.details).toEqual({ userId: 'user-1', familyId: 'fam-1' });
      expect(JSON.stringify(erro.details)).not.toMatch(/token/i);
    });

    it('rate limit registra o que vira cabeçalho de resposta', () => {
      const erro = new RateLimitExceededError(AGORA, 60);

      expect(erro.resetAt).toEqual(AGORA);
      expect(erro.limit).toBe(60);
    });

    it('o contexto é imutável', () => {
      const erro = new ValidationError('email', 'x');

      expect(() => {
        (erro.details as Record<string, unknown>).field = 'outro';
      }).toThrow();
    });

    it('erros sem contexto expõem um objeto vazio', () => {
      expect(new InvalidCredentialsError().details).toEqual({});
    });
  });
});

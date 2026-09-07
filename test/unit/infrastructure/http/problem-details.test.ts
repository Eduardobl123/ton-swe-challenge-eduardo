import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../../src/domain/errors';
import { problemDetails, statusFor } from '../../../../src/infrastructure/http/problem-details';
import { authenticatedUserId } from '../../../../src/infrastructure/http/plugins/auth';
import { toFieldError } from '../../../../src/infrastructure/http/plugins/error-handler';
import type { FastifyRequest, FastifySchemaValidationError } from 'fastify';

describe('problemDetails', () => {
  it('todo código do registro tem status mapeado', () => {
    // A tabela é exaustiva por tipo; este teste garante que ela também é
    // exaustiva em execução, sem valores ausentes.
    for (const code of ERROR_CODES) {
      expect(Number.isInteger(statusFor(code))).toBe(true);
    }
  });

  it('monta o corpo no formato da RFC 9457', () => {
    const corpo = problemDetails({
      code: 'NOT_FOUND',
      instance: '/v1/nada',
      requestId: 'req-1',
    });

    expect(corpo).toEqual({
      type: 'https://ton-swe-challenge/errors/not-found',
      title: 'Recurso não encontrado.',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/v1/nada',
      requestId: 'req-1',
    });
  });

  it('usa um título genérico para código sem título próprio', () => {
    // Acontece com os erros internos, que nunca chegam ao cliente como si
    // mesmos mas precisam de resposta se algum dia escaparem.
    const corpo = problemDetails({
      code: 'ACCOUNT_LOCKED',
      instance: '/v1/auth/login',
      requestId: 'req-1',
    });

    expect(corpo.title).toBe('Erro.');
  });

  it('inclui a lista de campos apenas quando há falha de validação', () => {
    const comCampos = problemDetails({
      code: 'VALIDATION_ERROR',
      instance: '/v1/auth/login',
      requestId: 'req-1',
      errors: [{ field: 'email', message: 'inválido' }],
    });
    const semCampos = problemDetails({
      code: 'NOT_FOUND',
      instance: '/x',
      requestId: 'req-1',
    });

    expect(comCampos.errors).toHaveLength(1);
    expect(semCampos).not.toHaveProperty('errors');
  });
});

describe('authenticatedUserId', () => {
  it('devolve o identificador preenchido pelo gancho de autenticação', () => {
    expect(authenticatedUserId({ authenticatedUser: { id: 'user-1' } } as FastifyRequest)).toBe(
      'user-1',
    );
  });

  it('recusa quando a rota não passou pela autenticação', () => {
    // Chamar isto em rota pública é defeito de montagem, não situação a tratar.
    expect(() => authenticatedUserId({ authenticatedUser: undefined } as FastifyRequest)).toThrow(
      /gancho de autenticação/,
    );
  });
});

/** Falha de schema com os campos que o Fastify exige, e só o que interessa aqui. */
const falha = (instancePath: string, message?: string): FastifySchemaValidationError => ({
  keyword: 'zod',
  instancePath,
  schemaPath: '#/zod',
  params: {},
  ...(message === undefined ? {} : { message }),
});

describe('toFieldError', () => {
  it('converte o ponteiro JSON em notação de ponto', () => {
    expect(toFieldError(falha('/page/limit', 'esperado número'))).toEqual({
      field: 'page.limit',
      message: 'esperado número',
    });
  });

  it('nomeia como corpo a falha que não pertence a campo nenhum', () => {
    // Devolver cadeia vazia obrigaria o cliente a tratar o caso sem pista do
    // que corrigir.
    expect(toFieldError(falha('', 'esperado objeto')).field).toBe('(corpo)');
  });

  it('usa uma mensagem genérica quando a validação não fornece uma', () => {
    expect(toFieldError(falha('/email')).message).toBe('valor inválido');
  });
});

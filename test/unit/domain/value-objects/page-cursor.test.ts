import { describe, expect, it } from 'vitest';
import { PageCursor } from '../../../../src/domain/value-objects';
import { InvalidCursorError } from '../../../../src/domain/errors';

describe('PageCursor', () => {
  it('preserva o valor recebido', () => {
    expect(PageCursor.create('eyJwayI6IlBST0RVQ1QjMSJ9').value).toBe('eyJwayI6IlBST0RVQ1QjMSJ9');
  });

  it('remove espaços nas pontas', () => {
    expect(PageCursor.create('  abc  ').value).toBe('abc');
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
  ])('recusa cursor %s', (_caso, raw) => {
    expect(() => PageCursor.create(raw)).toThrow(InvalidCursorError);
  });

  it('recusa cursor longo demais para ser legítimo', () => {
    expect(() => PageCursor.create('a'.repeat(2049))).toThrow(InvalidCursorError);
  });

  it('aceita cursor no limite de tamanho', () => {
    expect(() => PageCursor.create('a'.repeat(2048))).not.toThrow();
  });

  it('não explica por que o cursor é inválido', () => {
    // Detalhar a falha entregaria o formato interno das chaves da tabela.
    try {
      PageCursor.create('');
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect((error as InvalidCursorError).code).toBe('INVALID_CURSOR');
      expect((error as InvalidCursorError).message).not.toMatch(/chave|dynamo|hmac|assinatura/i);
    }
  });

  it('compara por valor', () => {
    expect(PageCursor.create('abc').equals(PageCursor.create('abc'))).toBe(true);
    expect(PageCursor.create('abc').equals(PageCursor.create('xyz'))).toBe(false);
  });

  it('serializa como texto', () => {
    const cursor = PageCursor.create('abc');

    expect(String(cursor)).toBe('abc');
    expect(JSON.stringify({ cursor })).toBe('{"cursor":"abc"}');
  });
});

import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PasswordHash } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdGluaG8$aGFzaC1kZS1tZW50aXJpbmhh';

describe('PasswordHash', () => {
  it('preserva o valor real para quem o pede explicitamente', () => {
    expect(PasswordHash.create(HASH).value).toBe(HASH);
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
  ])('recusa hash %s', (_caso, raw) => {
    expect(() => PasswordHash.create(raw)).toThrow(ValidationError);
  });

  describe('proteção contra vazamento acidental', () => {
    // Os três caminhos por onde um valor costuma escapar sem ninguém notar.
    const hash = PasswordHash.create(HASH);

    it('não aparece na serialização JSON', () => {
      const serializado = JSON.stringify({ passwordHash: hash });

      expect(serializado).not.toContain(HASH);
      expect(serializado).toBe('{"passwordHash":"[REDACTED]"}');
    });

    it('não aparece na conversão para texto', () => {
      expect(`${String(hash)}`).toBe('[REDACTED]');
      expect(String(hash)).not.toContain(HASH);
    });

    it('não aparece na inspeção do Node, usada por console.log e pelo logger', () => {
      const inspecionado = inspect({ user: { passwordHash: hash } }, { depth: 5 });

      expect(inspecionado).not.toContain(HASH);
      expect(inspecionado).toContain('[REDACTED]');
    });

    it('não aparece ao serializar uma estrutura aninhada', () => {
      const serializado = JSON.stringify({ dados: { usuario: { credencial: hash } } });

      expect(serializado).not.toContain('argon2id');
    });
  });
});

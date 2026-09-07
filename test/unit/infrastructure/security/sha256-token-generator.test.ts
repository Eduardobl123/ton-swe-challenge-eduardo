import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256TokenGenerator } from '../../../../src/infrastructure/security';

const generator = new Sha256TokenGenerator();

describe('Sha256TokenGenerator', () => {
  it('gera um valor diferente a cada chamada', () => {
    const valores = new Set(Array.from({ length: 200 }, () => generator.generate().value));

    expect(valores.size).toBe(200);
  });

  it('usa 256 bits de entropia', () => {
    // Menos enfraqueceria o segredo sem economizar nada; mais não acrescentaria
    // força, já que o espaço de busca passa a ser limitado pelo próprio hash.
    const { value } = generator.generate();

    expect(Buffer.from(value, 'base64url')).toHaveLength(32);
  });

  it('usa um alfabeto seguro para URL', () => {
    expect(generator.generate().value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('o hash acompanha o valor gerado', () => {
    const { value, hash } = generator.generate();

    expect(hash).toBe(generator.hash(value));
  });

  it('o hash é SHA-256 em hexadecimal', () => {
    const { value, hash } = generator.generate();

    expect(hash).toBe(createHash('sha256').update(value, 'utf8').digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o hash não permite recuperar o valor', () => {
    // É o que faz um vazamento do banco não render sessões utilizáveis.
    const { value, hash } = generator.generate();

    expect(hash).not.toContain(value);
    expect(value).not.toContain(hash);
  });

  it('o mesmo valor produz sempre o mesmo hash', () => {
    // Sem isso, localizar o registro pelo token apresentado seria impossível.
    expect(generator.hash('abc')).toBe(generator.hash('abc'));
  });

  it('valores diferentes produzem hashes diferentes', () => {
    expect(generator.hash('abc')).not.toBe(generator.hash('abd'));
  });
});

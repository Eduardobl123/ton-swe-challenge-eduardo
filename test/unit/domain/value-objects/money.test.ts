import { describe, expect, it } from 'vitest';
import { Money } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

describe('Money', () => {
  it('guarda o valor em centavos inteiros', () => {
    expect(Money.fromCents(1999).cents).toBe(1999);
  });

  it('aceita zero', () => {
    expect(Money.fromCents(0).cents).toBe(0);
  });

  it.each([
    ['fracionário', 19.99],
    ['negativo', -1],
    ['acima do inteiro seguro', Number.MAX_SAFE_INTEGER + 2],
    ['infinito', Number.POSITIVE_INFINITY],
    ['não numérico', Number.NaN],
  ])('recusa valor %s', (_caso, valor) => {
    expect(() => Money.fromCents(valor)).toThrow(ValidationError);
  });

  it('compara por valor, não por identidade', () => {
    expect(Money.fromCents(500).equals(Money.fromCents(500))).toBe(true);
    expect(Money.fromCents(500).equals(Money.fromCents(501))).toBe(false);
  });

  it('serializa como número de centavos', () => {
    expect(JSON.stringify({ price: Money.fromCents(1999) })).toBe('{"price":1999}');
  });

  it('não acumula erro de ponto flutuante ao somar centavos', () => {
    // A razão de existir do tipo: em `number`, 0.1 + 0.2 !== 0.3.
    const total = Money.fromCents(10).cents + Money.fromCents(20).cents;

    expect(Money.fromCents(total).equals(Money.fromCents(30))).toBe(true);
  });
});

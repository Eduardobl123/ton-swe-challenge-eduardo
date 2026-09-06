import { describe, expect, it } from 'vitest';
import { LockoutPolicy } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

/** Os mesmos valores padrão de `.env.example`. */
const padrao = (): LockoutPolicy =>
  LockoutPolicy.create({ maxAttempts: 5, baseDelayMs: 30_000, maxDelayMs: 900_000 });

const SEGUNDO = 1_000;

describe('LockoutPolicy', () => {
  describe('construção', () => {
    it.each([
      ['tentativas fracionárias', { maxAttempts: 1.5, baseDelayMs: 1000, maxDelayMs: 2000 }],
      ['tentativas zeradas', { maxAttempts: 0, baseDelayMs: 1000, maxDelayMs: 2000 }],
      ['tentativas negativas', { maxAttempts: -1, baseDelayMs: 1000, maxDelayMs: 2000 }],
      ['duração base zerada', { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 2000 }],
      ['duração base fracionária', { maxAttempts: 5, baseDelayMs: 1.5, maxDelayMs: 2000 }],
      ['duração máxima zerada', { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 0 }],
      ['duração máxima fracionária', { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 2.5 }],
    ])('recusa %s', (_caso, entrada) => {
      expect(() => LockoutPolicy.create(entrada)).toThrow(ValidationError);
    });

    it('recusa teto menor que a duração base', () => {
      // Configuração incoerente que o schema de ambiente não pega: cada valor é
      // um inteiro positivo válido, mas juntos não fazem sentido.
      expect(() =>
        LockoutPolicy.create({ maxAttempts: 5, baseDelayMs: 60_000, maxDelayMs: 30_000 }),
      ).toThrow(ValidationError);
    });

    it('aceita teto igual à duração base', () => {
      expect(() =>
        LockoutPolicy.create({ maxAttempts: 5, baseDelayMs: 30_000, maxDelayMs: 30_000 }),
      ).not.toThrow();
    });
  });

  describe('quando bloquear', () => {
    it.each([
      [0, false],
      [1, false],
      [4, false],
      [5, true],
      [6, true],
      [50, true],
    ])('com %i falhas acumuladas, bloqueia = %s', (falhas, esperado) => {
      expect(padrao().shouldLock(falhas)).toBe(esperado);
    });
  });

  describe('progressão do bloqueio', () => {
    it('não bloqueia enquanto o limite não é atingido', () => {
      const policy = padrao();

      expect(policy.lockDurationMs(0)).toBe(0);
      expect(policy.lockDurationMs(4)).toBe(0);
    });

    it.each([
      [5, 30 * SEGUNDO],
      [6, 60 * SEGUNDO],
      [7, 120 * SEGUNDO],
      [8, 240 * SEGUNDO],
      [9, 480 * SEGUNDO],
    ])('dobra a cada falha: %i falhas → %ims', (falhas, esperado) => {
      expect(padrao().lockDurationMs(falhas)).toBe(esperado);
    });

    it('respeita o teto de 15 minutos', () => {
      // O teto é o que impede o bloqueio de virar negação de serviço contra o
      // usuário legítimo. Ver ADR 0010.
      const policy = padrao();

      expect(policy.lockDurationMs(10)).toBe(900 * SEGUNDO);
      expect(policy.lockDurationMs(100)).toBe(900 * SEGUNDO);
    });

    it('não estoura o inteiro seguro com um número absurdo de falhas', () => {
      // Sem saturar o expoente, `2 ** n` viraria Infinity e o bloqueio deixaria
      // de ser calculável.
      const duracao = padrao().lockDurationMs(Number.MAX_SAFE_INTEGER);

      expect(Number.isFinite(duracao)).toBe(true);
      expect(duracao).toBe(900 * SEGUNDO);
    });
  });

  it('respeita a calibragem vinda do ambiente', () => {
    const frouxa = LockoutPolicy.create({
      maxAttempts: 10,
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
    });

    expect(frouxa.shouldLock(9)).toBe(false);
    expect(frouxa.lockDurationMs(10)).toBe(1_000);
    expect(frouxa.lockDurationMs(13)).toBe(5_000);
  });
});

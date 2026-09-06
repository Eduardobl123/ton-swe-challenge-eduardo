import { describe, expect, it } from 'vitest';
import { buildContainer } from '../../../src/main/container';
import { loadConfig } from '../../../src/infrastructure/config/env';
import { ValidationError } from '../../../src/domain/errors';
import { RecordingLogger } from '../../support/fakes';

const baseEnv = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
} satisfies NodeJS.ProcessEnv;

const montar = (overrides: NodeJS.ProcessEnv = {}) =>
  buildContainer(loadConfig({ ...baseEnv, ...overrides }), new RecordingLogger());

describe('buildContainer', () => {
  it('repassa a configuração validada', () => {
    expect(montar({ PORT: '8080' }).config.http.port).toBe(8080);
  });

  it('monta o caso de uso de autenticação', () => {
    expect(montar().useCases.authenticateUser).toBeDefined();
  });

  describe('política de bloqueio', () => {
    it('é construída a partir das variáveis de ambiente', () => {
      const { lockout } = montar({
        LOCKOUT_MAX_ATTEMPTS: '3',
        LOCKOUT_BASE_DELAY_MS: '10000',
        LOCKOUT_MAX_DELAY_MS: '60000',
      }).policies;

      expect(lockout.maxAttempts).toBe(3);
      expect(lockout.lockDurationMs(3)).toBe(10_000);
      expect(lockout.lockDurationMs(10)).toBe(60_000);
    });

    it('usa os padrões documentados quando nada é informado', () => {
      const { lockout } = montar().policies;

      expect(lockout.maxAttempts).toBe(5);
      expect(lockout.lockDurationMs(5)).toBe(30_000);
      expect(lockout.maxDelayMs).toBe(900_000);
    });

    it('recusa combinação incoerente que o schema de ambiente aceita', () => {
      // Cada valor isolado é um inteiro positivo válido, então o zod deixa
      // passar. A incoerência entre eles é regra de domínio e falha na subida,
      // não na primeira tentativa de login.
      expect(() =>
        montar({ LOCKOUT_BASE_DELAY_MS: '60000', LOCKOUT_MAX_DELAY_MS: '30000' }),
      ).toThrow(ValidationError);
    });
  });
});

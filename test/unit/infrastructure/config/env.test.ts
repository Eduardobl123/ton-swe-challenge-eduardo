import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  loadConfig,
  type AppConfig,
} from '../../../../src/infrastructure/config/env';

/**
 * Conjunto mínimo de variáveis sem valor padrão. Tudo o mais tem default no
 * schema, então cada teste declara apenas o que está exercitando.
 */
const requiredEnv = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
} satisfies NodeJS.ProcessEnv;

const load = (overrides: NodeJS.ProcessEnv = {}): AppConfig =>
  loadConfig({ ...requiredEnv, ...overrides });

describe('loadConfig', () => {
  describe('validação', () => {
    it('recusa a subida quando falta uma variável obrigatória', () => {
      expect(() => loadConfig({ JWT_SECRET: requiredEnv.JWT_SECRET })).toThrow(EnvValidationError);
    });

    it('recusa um JWT_SECRET curto demais para HMAC-SHA256', () => {
      expect(() => load({ JWT_SECRET: 'curto-demais' })).toThrow(EnvValidationError);
    });

    it('acumula todos os problemas em vez de reportar só o primeiro', () => {
      let captured: EnvValidationError | undefined;

      try {
        loadConfig({ JWT_SECRET: 'curto', PORT: 'não-é-número' });
      } catch (error) {
        captured = error as EnvValidationError;
      }

      expect(captured).toBeInstanceOf(EnvValidationError);
      expect(captured?.issues).toHaveLength(3);
      expect(captured?.issues.join('\n')).toContain('JWT_SECRET');
      expect(captured?.issues.join('\n')).toContain('TABLE_NAME');
      expect(captured?.issues.join('\n')).toContain('PORT');
    });

    it('rotula como raiz um problema que não pertence a nenhuma variável', () => {
      // Acontece quando a própria fonte não é um objeto de ambiente.
      let captured: EnvValidationError | undefined;

      try {
        loadConfig(null as unknown as NodeJS.ProcessEnv);
      } catch (error) {
        captured = error as EnvValidationError;
      }

      expect(captured).toBeInstanceOf(EnvValidationError);
      expect(captured?.issues.join('\n')).toContain('(raiz)');
    });

    it('aponta o arquivo de referência na mensagem de erro', () => {
      expect(() => loadConfig({})).toThrow(/\.env\.example/);
    });

    it.each([
      ['PORT', '0'],
      ['PORT', '70000'],
      ['SENTRY_TRACES_SAMPLE_RATE', '1.5'],
      ['JWT_ACCESS_TTL_SECONDS', '-1'],
      ['LOCKOUT_MAX_ATTEMPTS', '0'],
      ['NODE_ENV', 'staging'],
      ['LOG_LEVEL', 'verbose'],
      ['DYNAMODB_ENDPOINT', 'não-é-uma-url'],
    ])('rejeita %s fora do domínio permitido (%s)', (variable, value) => {
      expect(() => load({ [variable]: value })).toThrow(EnvValidationError);
    });
  });

  describe('valores padrão', () => {
    it('assume desenvolvimento quando NODE_ENV não é informado', () => {
      const config = load();

      expect(config.nodeEnv).toBe('development');
      expect(config.isProduction).toBe(false);
      expect(config.http.port).toBe(3000);
      expect(config.auth.accessTtlSeconds).toBe(900);
      expect(config.rateLimit.productsPerMinute).toBe(60);
      expect(config.rateLimit.failOpen).toBe(true);
    });

    it('marca isProduction apenas em produção', () => {
      expect(load({ NODE_ENV: 'production' }).isProduction).toBe(true);
      expect(load({ NODE_ENV: 'test' }).isProduction).toBe(false);
    });
  });

  describe('conversão de tipos', () => {
    it('converte números vindos como texto', () => {
      const config = load({ PORT: '8080', RATE_LIMIT_LOGIN_PER_MINUTE: '3' });

      expect(config.http.port).toBe(8080);
      expect(config.rateLimit.loginPerMinute).toBe(3);
    });

    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('interpreta o booleano %s como %s', (raw, expected) => {
      expect(load({ RATE_LIMIT_FAIL_OPEN: raw }).rateLimit.failOpen).toBe(expected);
    });

    it('divide CORS_ORIGINS em lista, ignorando espaços e entradas vazias', () => {
      const config = load({ CORS_ORIGINS: 'https://a.com , https://b.com ,' });

      expect(config.http.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
    });
  });

  describe('variáveis opcionais', () => {
    it('trata variável presente porém vazia como ausente', () => {
      const config = load({ SENTRY_DSN: '', DYNAMODB_ENDPOINT: '   ' });

      expect(config.observability.sentryDsn).toBeUndefined();
      expect(config.persistence.endpoint).toBeUndefined();
    });

    it('mantém o endpoint local quando informado', () => {
      const config = load({ DYNAMODB_ENDPOINT: 'http://localhost:8000' });

      expect(config.persistence.endpoint).toBe('http://localhost:8000');
    });
  });

  describe('agrupamento da configuração', () => {
    it('expõe cada assunto na sua própria fatia', () => {
      const config = load({ NODE_ENV: 'production', APP_VERSION: 'abc1234' });

      expect(config.version).toBe('abc1234');
      expect(config.auth.jwtSecret).toBe(requiredEnv.JWT_SECRET);
      expect(config.persistence.tableName).toBe('ton-challenge-test');
      expect(config.lockout).toEqual({
        maxAttempts: 5,
        baseDelayMs: 30_000,
        maxDelayMs: 900_000,
      });
    });

    it('ignora variáveis desconhecidas do ambiente', () => {
      expect(() => load({ VARIAVEL_QUE_NAO_EXISTE: 'x' })).not.toThrow();
    });
  });
});

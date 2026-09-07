import { z } from 'zod';

/**
 * Leitura e validação das variáveis de ambiente.
 *
 * A aplicação falha na subida, não na primeira requisição: um `TABLE_NAME`
 * ausente ou um `JWT_SECRET` curto demais viram erro de boot com a lista do que
 * corrigir. No Lambda isso significa que a invocação quebra imediatamente e o
 * problema aparece no deploy, em vez de virar um 500 intermitente em produção.
 */

/** Aceita as grafias usuais de booleano em variáveis de ambiente. */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Variável presente porém vazia (`FOO=`) equivale a variável ausente. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_VERSION: z.string().min(1).default('local'),

  JWT_SECRET: z
    .string()
    .min(32, 'precisa ter ao menos 32 caracteres (256 bits) — gere com `openssl rand -base64 48`'),
  JWT_ISSUER: z.string().min(1).default('ton-swe-challenge'),
  JWT_AUDIENCE: z.string().min(1).default('ton-swe-challenge-api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),

  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOCKOUT_BASE_DELAY_MS: z.coerce.number().int().positive().default(30_000),
  LOCKOUT_MAX_DELAY_MS: z.coerce.number().int().positive().default(900_000),

  AWS_REGION: z.string().min(1).default('us-east-1'),
  TABLE_NAME: z.string().min(1),
  DYNAMODB_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),

  RATE_LIMIT_PRODUCTS_PER_MINUTE: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REFRESH_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_FAIL_OPEN: booleanFromString.default(true),

  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  CORS_ORIGINS: z.string().min(1).default('*'),
  SWAGGER_ENABLED: booleanFromString.default(true),

  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];
export type NodeEnv = z.infer<typeof envSchema>['NODE_ENV'];

/**
 * Configuração já validada e agrupada por assunto.
 *
 * Os adaptadores recebem só a fatia que lhes diz respeito, o que evita passar o
 * objeto inteiro (e o `JWT_SECRET` junto) para quem só precisa saber a porta.
 */
export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly version: string;
  readonly http: {
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly swaggerEnabled: boolean;
    /**
     * Quantos proxies existem à frente da aplicação.
     *
     * Zero significa não confiar em cabeçalho de encaminhamento algum, que é o
     * correto quando a aplicação recebe conexões diretas. Atrás do API Gateway
     * o valor é 1.
     *
     * Confiar na cadeia inteira seria pior que não confiar em nada: o primeiro
     * item de `X-Forwarded-For` é escrito por quem faz a requisição, então
     * qualquer cliente escolheria a própria identidade e a cota por origem
     * deixaria de existir.
     */
    readonly trustedProxyHops: number;
  };
  readonly log: {
    readonly level: LogLevel;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly issuer: string;
    readonly audience: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlSeconds: number;
  };
  readonly lockout: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
  readonly persistence: {
    readonly region: string;
    readonly tableName: string;
    /** Definido apenas em desenvolvimento, apontando para o DynamoDB Local. */
    readonly endpoint: string | undefined;
  };
  readonly rateLimit: {
    readonly productsPerMinute: number;
    readonly loginPerMinute: number;
    readonly refreshPerMinute: number;
    readonly failOpen: boolean;
  };
  readonly observability: {
    readonly sentryDsn: string | undefined;
    readonly sentryTracesSampleRate: number;
  };
}

/** Erro de boot: agrega todos os problemas de configuração de uma vez. */
export class EnvValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [
        'Configuração de ambiente inválida. Corrija as variáveis abaixo e suba novamente.',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'Referência completa das variáveis: .env.example',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Valida a fonte informada e devolve a configuração da aplicação.
 *
 * @param source Normalmente `process.env`; nos testes, um objeto literal.
 * @throws {EnvValidationError} quando qualquer variável está ausente ou inválida.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const variable = issue.path.join('.') || '(raiz)';
      return `${variable}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    version: env.APP_VERSION,
    http: {
      port: env.PORT,
      corsOrigins: env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      swaggerEnabled: env.SWAGGER_ENABLED,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    },
    log: {
      level: env.LOG_LEVEL,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    },
    lockout: {
      maxAttempts: env.LOCKOUT_MAX_ATTEMPTS,
      baseDelayMs: env.LOCKOUT_BASE_DELAY_MS,
      maxDelayMs: env.LOCKOUT_MAX_DELAY_MS,
    },
    persistence: {
      region: env.AWS_REGION,
      tableName: env.TABLE_NAME,
      endpoint: env.DYNAMODB_ENDPOINT,
    },
    rateLimit: {
      productsPerMinute: env.RATE_LIMIT_PRODUCTS_PER_MINUTE,
      loginPerMinute: env.RATE_LIMIT_LOGIN_PER_MINUTE,
      refreshPerMinute: env.RATE_LIMIT_REFRESH_PER_MINUTE,
      failOpen: env.RATE_LIMIT_FAIL_OPEN,
    },
    observability: {
      sentryDsn: env.SENTRY_DSN,
      sentryTracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    },
  };
}

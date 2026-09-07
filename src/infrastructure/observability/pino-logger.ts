import { pino } from 'pino';
import type { LoggerOptions, Logger as PinoInstance } from 'pino';
import type { LogFields, Logger } from '../../domain/ports';

export interface PinoLoggerOptions {
  readonly level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly environment: string;
  /** Versão da aplicação. No CI, o SHA do commit. */
  readonly version: string;
  /** Formato legível para leitura humana; JSON de uma linha para o resto. */
  readonly pretty: boolean;
}

/**
 * Caminhos por onde valor sensível costuma escapar sem ninguém notar.
 *
 * O tipo `LogFields` já impede passar objeto para o log, então nenhuma
 * chamada nossa consegue vazar um hash. Isto cobre o que o próprio pino
 * acrescenta — cabeçalhos de requisição, principalmente — e o que uma
 * biblioteca futura possa anexar sem passar pela porta.
 *
 * A lista é redundante de propósito. Redaction é barata e o custo de descobrir
 * que faltava um caminho é um segredo publicado em log retido por anos.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'authorization',
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'secret',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.authorization',
];

/**
 * Log estruturado com pino.
 *
 * Uma linha de JSON por evento, escrita no stdout. No Lambda é o CloudWatch que
 * recolhe daí, sem agente nenhum, e JSON é o que torna a busca por campo
 * possível — texto livre só permite procurar por trecho, e não há como remover
 * campo sensível de forma sistemática.
 *
 * O nome do evento é estável e vem primeiro: `auth.login.failed` é agregável e
 * alertável; "falha ao autenticar usuário" muda quando alguém reescreve a
 * mensagem e leva o alarme junto.
 */
/**
 * Monta a configuração do pino.
 *
 * Separada do construtor para poder ser conferida sem instanciar o logger: o
 * modo legível carrega um transporte que roda em outra thread, e criá-lo só
 * para verificar que a opção foi passada deixaria processo pendurado no teste.
 */
export function pinoOptions(options: PinoLoggerOptions): LoggerOptions {
  return {
    level: options.level,
    base: {
      // Presentes em toda linha: sem eles, achar as requisições de uma versão
      // específica exigiria correlacionar com o histórico de deploy.
      env: options.environment,
      version: options.version,
    },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // ISO-8601 em vez de milissegundos: o custo é irrelevante e a linha fica
    // legível sem ferramenta.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // `info` em vez de `30`. Consulta escrita por humano usa o nome.
      level: (label) => ({ level: label }),
    },
    ...(options.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  };
}

export class PinoLogger implements Logger {
  private readonly logger: PinoInstance;

  constructor(options: PinoLoggerOptions, destination?: NodeJS.WritableStream) {
    this.logger = pino(pinoOptions(options), destination);
  }

  public info(event: string, fields: LogFields = {}): void {
    this.logger.info(withoutUndefined(fields), event);
  }

  public warn(event: string, fields: LogFields = {}): void {
    this.logger.warn(withoutUndefined(fields), event);
  }

  public error(event: string, fields: LogFields = {}): void {
    this.logger.error(withoutUndefined(fields), event);
  }
}

/** Chave ausente é mais barata de consultar do que valor nulo. */
function withoutUndefined(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

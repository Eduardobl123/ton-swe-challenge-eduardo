import type { Clock, LogFields, Logger } from '../../domain/ports';

export type Level = 'info' | 'warn' | 'error';

/**
 * O `LOG_LEVEL` do ambiente admite seis níveis; a porta `Logger` expõe três.
 * Níveis mais detalhados que `info` colapsam nele, e `fatal` colapsa em `error`.
 * O pino (issue #9) passa a honrar os seis.
 *
 * Vive aqui, e não no entrypoint, para entrar no relatório de cobertura: é um
 * mapeamento pequeno e fácil de errar em silêncio.
 */
export function minimumLevelFor(
  configured: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
): Level {
  switch (configured) {
    case 'fatal':
    case 'error':
      return 'error';
    case 'warn':
      return 'warn';
    default:
      return 'info';
  }
}

/**
 * Logger estruturado mínimo, escrevendo JSON de uma linha no stdout.
 *
 * O `pino` entra na issue #9, junto com redaction, identificador de requisição
 * e integração com o Sentry. O que já vale agora é o **formato**: uma linha por
 * evento, campos nomeados, nome de evento estável. Trocar a implementação
 * depois não muda o contrato nem invalida consulta nenhuma feita nesse
 * meio-tempo.
 *
 * No Lambda o stdout é coletado pelo CloudWatch sem agente, então JSON de uma
 * linha já é consultável — texto livre não seria.
 */
export interface JsonConsoleLoggerOptions {
  readonly clock: Clock;
  readonly minimumLevel?: Level;
  /** Destino da linha. Injetável para que o teste não dependa do stdout. */
  readonly write?: (line: string) => void;
}

export class JsonConsoleLogger implements Logger {
  private readonly clock: Clock;
  private readonly minimumLevel: Level;
  private readonly write: (line: string) => void;

  constructor({ clock, minimumLevel = 'info', write }: JsonConsoleLoggerOptions) {
    this.clock = clock;
    this.minimumLevel = minimumLevel;
    this.write =
      write ??
      ((line): void => {
        process.stdout.write(`${line}\n`);
      });
  }

  public info(event: string, fields: LogFields = {}): void {
    this.emit('info', event, fields);
  }

  public warn(event: string, fields: LogFields = {}): void {
    this.emit('warn', event, fields);
  }

  public error(event: string, fields: LogFields = {}): void {
    this.emit('error', event, fields);
  }

  private emit(level: Level, event: string, fields: LogFields): void {
    if (SEVERITY[level] < SEVERITY[this.minimumLevel]) {
      return;
    }

    // Campos indefinidos são omitidos em vez de virarem `null`: uma chave
    // ausente é mais barata de consultar do que um valor vazio.
    const defined = Object.entries(fields).filter(([, value]) => value !== undefined);

    this.write(
      JSON.stringify({
        level,
        time: this.clock.now().toISOString(),
        event,
        ...Object.fromEntries(defined),
      }),
    );
  }
}

const SEVERITY: Record<Level, number> = { info: 0, warn: 1, error: 2 };

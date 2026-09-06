import type { LogFields, Logger } from '../../domain/ports';

type Level = 'info' | 'warn' | 'error';

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
export class JsonConsoleLogger implements Logger {
  constructor(
    private readonly minimumLevel: Level = 'info',
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ) {}

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
        time: new Date().toISOString(),
        event,
        ...Object.fromEntries(defined),
      }),
    );
  }
}

const SEVERITY: Record<Level, number> = { info: 0, warn: 1, error: 2 };

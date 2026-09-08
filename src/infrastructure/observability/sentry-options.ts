import { scrub } from './sentry-error-reporter';
import type { ErrorEvent } from '@sentry/node';
import type { AppConfig } from '../config/env';

export interface SentryInitOptions {
  readonly dsn: string;
  readonly environment: string;
  /** Versão da aplicação, que agrupa os eventos por implantação. */
  readonly release: string;
  readonly tracesSampleRate: number;
  readonly sendDefaultPii: false;
  readonly beforeSend: (event: ErrorEvent) => ErrorEvent;
}

/**
 * As opções que valem em qualquer runtime.
 *
 * O que muda entre o servidor e a Lambda é **qual SDK** as aplica: o de processo
 * longo, ou o que descarrega a fila antes de a invocação congelar. O que não
 * pode mudar é o `beforeSend` — credencial em relatório de erro fica retida por
 * muito tempo em sistema de terceiro.
 *
 * Elas viviam duplicadas nos dois entrypoints, e a cópia da Lambda tinha esquecido
 * justamente o `beforeSend`. Como os dois SDKs compartilham o mesmo registro
 * global, o segundo `init` substituía o cliente do primeiro e o scrubbing sumia
 * do caminho publicado (issue #30). Uma origem só remove a chance de divergirem
 * de novo.
 *
 * Devolve `undefined` quando não há DSN: sem ele nada deve ser inicializado, e
 * concentrar essa decisão aqui evita que um entrypoint futuro esqueça a guarda.
 */
export function sentryOptions(config: AppConfig): SentryInitOptions | undefined {
  const { sentryDsn, sentryTracesSampleRate } = config.observability;

  if (sentryDsn === undefined) {
    return undefined;
  }

  return {
    dsn: sentryDsn,
    environment: config.nodeEnv,
    release: config.version,
    tracesSampleRate: sentryTracesSampleRate,
    // Sem coleta automática de dado pessoal: cabeçalho, corpo e endereço só
    // entram no evento se alguém colocar de propósito.
    sendDefaultPii: false,
    beforeSend: scrub,
  };
}

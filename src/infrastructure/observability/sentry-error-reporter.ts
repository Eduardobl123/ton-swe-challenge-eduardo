import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import type { ErrorContext, ErrorReporter, Logger } from '../../domain/ports';

export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  /** Versão da aplicação, que agrupa os eventos por implantação. */
  readonly release: string;
  readonly tracesSampleRate: number;
}

/**
 * Encaminha falhas imprevistas para o Sentry.
 *
 * O identificador da requisição vira etiqueta, e é ele que fecha o ciclo: da
 * reclamação de quem usou, para a linha de log, para o evento com a pilha. Sem
 * essa amarração, investigar um erro relatado começa por adivinhar qual das
 * requisições daquele minuto era a certa.
 *
 * O usuário é identificado apenas pelo `id`. E-mail em ferramenta de terceiro é
 * dado pessoal saindo do perímetro sem necessidade — o identificador basta para
 * juntar os eventos de uma mesma pessoa.
 */
/**
 * Remove da amostra tudo que possa carregar credencial.
 *
 * Cinto e suspensório: a coleta automática de dado pessoal já está desligada,
 * mas uma integração futura pode anexar a requisição, e credencial em relatório
 * de erro fica retida por muito tempo em sistema de terceiro.
 */
export function scrub(event: ErrorEvent): ErrorEvent {
  if (event.request !== undefined) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
  }

  return event;
}

export class SentryErrorReporter implements ErrorReporter {
  constructor(private readonly logger: Logger) {}

  public static initialise(options: SentryOptions): void {
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      release: options.release,
      tracesSampleRate: options.tracesSampleRate,
      // Sem coleta automática de dado pessoal: cabeçalho, corpo e endereço só
      // entram no evento se alguém colocar de propósito.
      sendDefaultPii: false,
      beforeSend: scrub,
    });
  }

  public capture(error: unknown, context: ErrorContext): void {
    try {
      Sentry.withScope((scope) => {
        scope.setTag('requestId', context.requestId);
        scope.setTag('route', context.route);

        if (context.userId !== undefined) {
          scope.setUser({ id: context.userId });
        }

        Sentry.captureException(error);
      });
    } catch (reportingFailure) {
      // Falha ao relatar não pode derrubar a requisição: seria transformar um
      // problema de observabilidade em indisponibilidade.
      this.logger.error('observability.report_failed', {
        requestId: context.requestId,
        reason: reportingFailure instanceof Error ? reportingFailure.message : 'desconhecido',
      });
    }
  }
}

/**
 * Usado quando não há DSN configurado, que é o caso em desenvolvimento e no CI.
 *
 * Exigir DSN para subir a aplicação obrigaria cada pessoa a ter uma conta do
 * Sentry para rodar testes, e a alternativa comum — um DSN de brincadeira
 * commitado — polui o projeto real de alguém.
 */
export class NoopErrorReporter implements ErrorReporter {
  public capture(): void {
    // Silêncio deliberado: o erro já foi registrado no log pelo tratador.
  }
}

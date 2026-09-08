import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import {
  NoopErrorReporter,
  SentryErrorReporter,
  scrub,
} from '../../../../src/infrastructure/observability';
import { RecordingLogger } from '../../../support/fakes';

/**
 * O módulo do Sentry é substituído por inteiro.
 *
 * Exportação de módulo ESM não aceita espião, e injetar o cliente no adaptador
 * só para o teste criaria um parâmetro que existe por causa do teste. O que
 * precisa ser provado é o que sairia dali: etiquetas, identificação do usuário
 * e o que acontece quando o serviço falha.
 */
const escopo = { setTag: vi.fn(), setUser: vi.fn() };
const captureException = vi.fn();
const withScope = vi.fn((callback: (s: typeof escopo) => void) => {
  callback(escopo);
});

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: (error: unknown): void => {
    captureException(error);
  },
  withScope: (callback: (s: typeof escopo) => void): void => {
    withScope(callback);
  },
}));

const contexto = { requestId: 'req-1', route: '/v1/products', userId: 'user-1' };

describe('SentryErrorReporter', () => {
  beforeEach(() => {
    escopo.setTag.mockClear();
    escopo.setUser.mockClear();
    captureException.mockClear();
    withScope.mockClear();
    withScope.mockImplementation((callback) => {
      callback(escopo);
    });
  });

  it('etiqueta o evento com o identificador da requisição e a rota', () => {
    // É o que fecha o ciclo: da reclamação de quem usou, para a linha de log,
    // para o evento com a pilha.
    new SentryErrorReporter(new RecordingLogger()).capture(new Error('falhou'), contexto);

    expect(escopo.setTag).toHaveBeenCalledWith('requestId', 'req-1');
    expect(escopo.setTag).toHaveBeenCalledWith('route', '/v1/products');
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('identifica o usuário só pelo id, nunca pelo e-mail', () => {
    // E-mail em ferramenta de terceiro é dado pessoal saindo do perímetro sem
    // necessidade.
    new SentryErrorReporter(new RecordingLogger()).capture(new Error('x'), contexto);

    expect(escopo.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('omite o usuário quando a rota é pública', () => {
    new SentryErrorReporter(new RecordingLogger()).capture(new Error('x'), {
      ...contexto,
      userId: undefined,
    });

    expect(escopo.setUser).not.toHaveBeenCalled();
  });

  it('falha ao relatar não derruba a requisição', () => {
    // Seria transformar um problema de observabilidade em indisponibilidade.
    withScope.mockImplementation(() => {
      throw new Error('Sentry fora do ar');
    });
    const logger = new RecordingLogger();

    expect(() => new SentryErrorReporter(logger).capture(new Error('x'), contexto)).not.toThrow();
    expect(logger.find('observability.report_failed')?.fields.reason).toBe('Sentry fora do ar');
  });

  it('registra motivo genérico quando a falha não é um Error', () => {
    withScope.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'texto solto';
    });
    const logger = new RecordingLogger();

    new SentryErrorReporter(logger).capture(new Error('x'), contexto);

    expect(logger.find('observability.report_failed')?.fields.reason).toBe('desconhecido');
  });

  it('não inicializa o SDK', () => {
    // Configurar o cliente é do entrypoint. Enquanto era também do adaptador, o
    // `init` da Lambda substituía o do container e o scrubbing sumia do caminho
    // publicado (issue #30). Ver `sentry-options.test.ts`.
    expect('initialise' in SentryErrorReporter).toBe(false);
  });
});

describe('NoopErrorReporter', () => {
  it('descarta sem falhar', () => {
    // Usado quando não há DSN, que é o caso em desenvolvimento e no CI. Exigir
    // DSN para subir obrigaria cada pessoa a ter uma conta do Sentry para rodar
    // testes.
    expect(() => new NoopErrorReporter().capture()).not.toThrow();
  });
});

describe('scrub', () => {
  it('remove cabeçalhos, cookies e corpo do evento', () => {
    // Credencial em relatório de erro fica retida por muito tempo em sistema de
    // terceiro. A coleta automática já está desligada; isto cobre o que uma
    // integração futura possa anexar.
    const limpo = scrub({
      request: {
        url: '/v1/auth/login',
        headers: { authorization: 'Bearer segredo' },
        cookies: { sessao: 'segredo' },
        data: { password: 'segredo' },
      },
    } as unknown as ErrorEvent);

    expect(limpo.request).toEqual({ url: '/v1/auth/login' });
    expect(JSON.stringify(limpo)).not.toContain('segredo');
  });

  it('não altera evento sem requisição anexada', () => {
    expect(scrub({ message: 'falhou' } as ErrorEvent)).toEqual({ message: 'falhou' });
  });
});

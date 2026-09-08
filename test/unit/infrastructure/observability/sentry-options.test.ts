import * as SentryLambda from '@sentry/aws-serverless';
import * as SentryNode from '@sentry/node';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../../../../src/infrastructure/config/env';
import {
  scrub,
  sentryOptions,
  type SentryInitOptions,
} from '../../../../src/infrastructure/observability';
import type { ErrorEvent } from '@sentry/node';

const DSN = 'https://exemplo@o0.ingest.sentry.io/0';

const requiredEnv = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
  PERSISTENCE: 'memory',
} satisfies NodeJS.ProcessEnv;

const load = (overrides: NodeJS.ProcessEnv = {}): AppConfig =>
  loadConfig({ ...requiredEnv, ...overrides });

const comDsn = (): SentryInitOptions => {
  const opcoes = sentryOptions(load({ SENTRY_DSN: DSN }));

  if (opcoes === undefined) {
    throw new Error('esperava opções para um DSN configurado');
  }

  return opcoes;
};

describe('sentryOptions', () => {
  it('não devolve opções quando não há DSN', () => {
    // Sem DSN nada deve ser inicializado: exigir uma conta do Sentry para subir
    // a aplicação quebraria desenvolvimento e CI.
    expect(sentryOptions(load({ SENTRY_DSN: '' }))).toBeUndefined();
  });

  it('leva o beforeSend de scrubbing', () => {
    // É a opção que a cópia da Lambda tinha esquecido. Ter uma origem só é o que
    // impede os dois entrypoints de divergirem de novo.
    expect(comDsn().beforeSend).toBe(scrub);
  });

  it('desliga a coleta automática de dado pessoal', () => {
    expect(comDsn().sendDefaultPii).toBe(false);
  });

  it('traduz DSN, ambiente, versão e amostragem', () => {
    const opcoes = sentryOptions(
      load({ SENTRY_DSN: DSN, APP_VERSION: 'abc1234', SENTRY_TRACES_SAMPLE_RATE: '0.25' }),
    );

    expect(opcoes).toMatchObject({ dsn: DSN, release: 'abc1234', tracesSampleRate: 0.25 });
  });
});

/**
 * Forma mínima do envelope entregue ao transporte.
 *
 * O SDK não exporta os tipos `Envelope`/`Transport` na sua entrada pública, e o
 * envelope real é atribuível a esta forma — o suficiente para achar o item de
 * evento sem recorrer a `any`.
 */
type Envelope = [unknown, [{ type: string }, unknown][]];

/** O SDK também emite envelope de sessão; o que interessa é o item de evento. */
const eventoDe = (envelopes: readonly Envelope[]): ErrorEvent | undefined => {
  for (const [, itens] of envelopes) {
    for (const [cabecalho, corpo] of itens) {
      if (cabecalho.type === 'event') {
        return corpo as ErrorEvent;
      }
    }
  }

  return undefined;
};

/**
 * Prova o efeito, não a configuração.
 *
 * Os testes acima garantem que o `beforeSend` está nas opções; estes garantem
 * que ele roda de verdade no SDK que a Lambda usa. Era aí que o defeito morava:
 * as opções certas existiam no container, e o `init` da Lambda — chegando depois
 * e sem `beforeSend` — substituía aquele cliente. A asserção relevante é sobre o
 * evento que sai, com um transporte falso no lugar da rede.
 */
describe('scrubbing no SDK da Lambda', () => {
  afterEach(async () => {
    await SentryNode.close();
  });

  it('remove cabeçalhos, cookies e corpo do evento que sai', async () => {
    const enviados: Envelope[] = [];

    SentryLambda.init({
      ...comDsn(),
      transport: () => ({
        send: (envelope: Envelope) => {
          enviados.push(envelope);
          return Promise.resolve({});
        },
        flush: () => Promise.resolve(true),
      }),
    });

    SentryNode.withScope((scope) => {
      scope.addEventProcessor((evento) => {
        evento.request = {
          url: '/v1/auth/login',
          headers: { authorization: 'Bearer segredo' },
          cookies: { sessao: 'segredo' },
          data: { password: 'segredo' },
        };

        return evento;
      });
      SentryNode.captureException(new Error('falha imprevista'));
    });

    await SentryNode.flush(2000);

    const evento = eventoDe(enviados);

    expect(evento?.request).toEqual({ url: '/v1/auth/login' });
    // A asserção é sobre a requisição, e não sobre o evento inteiro: a
    // integração `ContextLines` anexa as linhas de código ao redor da falha, e
    // elas incluem o literal usado aqui no teste.
    expect(JSON.stringify(evento?.request)).not.toContain('segredo');
  });

  it('o cliente vigente é o que carrega o beforeSend', () => {
    // Guarda contra a regressão específica: se alguém reintroduzir um segundo
    // `init` sem `beforeSend`, o cliente global passa a ser o desconfigurado.
    SentryLambda.init(comDsn());

    expect(SentryNode.getClient()?.getOptions().beforeSend).toBe(scrub);
  });
});

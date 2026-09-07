import { buildApp } from '../../src/infrastructure/http/app';
import { buildContainer, type Container } from '../../src/main/container';
import { loadConfig } from '../../src/infrastructure/config/env';
import { seedForDevelopment } from '../../src/main/dev-seed';
import { RecordingLogger } from './fakes';
import type { FastifyInstance } from 'fastify';

export const DEMO_EMAIL = 'demo@ton.com.br';
export const DEMO_PASSWORD = 'Desafio@Ton2026';

const baseEnv = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
  // Sem Docker: a persistência real é exercitada pelos testes de integração.
  PERSISTENCE: 'memory',
  // A documentação interativa não participa dos testes de contrato.
  SWAGGER_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

export interface TestApp {
  readonly app: FastifyInstance;
  readonly container: Container;
  readonly logger: RecordingLogger;
}

/**
 * Sobe a aplicação inteira com adaptadores em memória.
 *
 * `app.inject` percorre todo o caminho real — plugins, validação, rotas,
 * tratamento de erro e serialização — sem abrir porta de rede. É o que permite
 * testar a superfície HTTP de verdade sem esperar por socket nem depender de
 * porta livre.
 */
export async function buildTestApp(overrides: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const logger = new RecordingLogger();
  const container = buildContainer(loadConfig({ ...baseEnv, ...overrides }), logger);

  await seedForDevelopment(container, { email: DEMO_EMAIL, password: DEMO_PASSWORD });

  return { app: await buildApp(container), container, logger };
}

/**
 * Sobe a aplicação com uma sonda de prontidão controlada.
 *
 * Substituir a sonda depois de montar o container seria mexer em objeto já
 * construído; montar com a sonda desejada é o caminho normal do composition
 * root.
 */
export async function buildAppWithReadiness(ready: boolean): Promise<FastifyInstance> {
  const container = buildContainer(loadConfig(baseEnv), new RecordingLogger());

  return buildApp({
    ...container,
    services: { ...container.services, readiness: { check: () => Promise.resolve(ready) } },
  });
}

/**
 * Sobe a aplicação com um caso de uso que falha de um jeito escolhido.
 *
 * É o que permite exercitar os caminhos de erro imprevisto sem criar rota de
 * teste no código de produção — uma rota que só existe para quebrar é uma porta
 * que alguém esquece aberta.
 */
export async function buildAppWithFailingList(
  behaviour: 'throws' | 'invalid-shape',
): Promise<FastifyInstance> {
  const container = buildContainer(loadConfig(baseEnv), new RecordingLogger());
  await seedForDevelopment(container, { email: DEMO_EMAIL, password: DEMO_PASSWORD });

  const listProducts = {
    execute: () =>
      behaviour === 'throws'
        ? Promise.reject(new Error('falha interna inesperada'))
        : // Passa pelo handler e só falha na serialização: `limit` deveria ser
          // número. É o que exercita a divergência entre resposta e contrato.
          Promise.resolve({
            data: [],
            page: { limit: 'não é número', hasMore: false, limitClamped: false },
          } as never),
  };

  return buildApp({
    ...container,
    useCases: { ...container.useCases, listProducts: listProducts as never },
  });
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export async function login(
  app: FastifyInstance,
  email = DEMO_EMAIL,
  password = DEMO_PASSWORD,
): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
  });

  return response.json<Session>();
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

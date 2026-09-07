import { writeFile } from 'node:fs/promises';
import { buildApp } from '../src/infrastructure/http/app';
import { buildContainer } from '../src/main/container';
import { loadConfig } from '../src/infrastructure/config/env';
import type { Logger } from '../src/domain/ports';

/**
 * Exporta o contrato OpenAPI para `docs/openapi.json`.
 *
 * O arquivo é versionado e regenerado no CI (issue #11), que compara o
 * resultado com o que está no repositório. Assim, mudar uma rota sem atualizar
 * o contrato quebra o build em vez de quebrar o consumidor.
 *
 * A configuração usada é fixa e neutra de propósito: o documento não deve mudar
 * porque alguém tem um `.env` diferente.
 */
const SPEC_ENV = {
  JWT_SECRET: 'valor-neutro-apenas-para-gerar-o-contrato-openapi',
  TABLE_NAME: 'ton-challenge',
  APP_VERSION: '1.0.0',
  SWAGGER_ENABLED: 'true',
} satisfies NodeJS.ProcessEnv;

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function main(): Promise<void> {
  const app = await buildApp(buildContainer(loadConfig(SPEC_ENV), silent));
  await app.ready();

  const spec = app.swagger();
  await writeFile('docs/openapi.json', `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await app.close();

  const routes = Object.keys((spec as { paths: Record<string, unknown> }).paths).length;
  console.log(`docs/openapi.json atualizado com ${String(routes)} rotas.`);
}

await main();

import { defineConfig } from 'tsup';

/**
 * Pacotes que **não** podem ser embutidos no bundle.
 *
 * O critério é um só: o pacote lê arquivos reais do disco em tempo de execução.
 * Um bundle é um arquivo de JavaScript, então tudo que ele carrega por caminho
 * — binário nativo, asset estático, script de worker — deixa de existir no
 * momento em que o pacote entra nele. O erro não aparece no build: aparece na
 * primeira execução, e às vezes só quando aquele caminho específico roda.
 *
 * - `@node-rs/argon2`: binário nativo, escolhido por plataforma.
 * - `@fastify/swagger-ui`: serve `logo.svg` e o resto da interface a partir do
 *   próprio diretório, via `__dirname`.
 * - `pino`: no modo legível sobe um worker lendo `lib/worker.js` do disco.
 *
 * Esta lista é a única fonte da verdade. O `scripts/package-lambda.ts` não a
 * repete: ele lê os `import` que sobraram no bundle e instala exatamente esses
 * pacotes no artefato. Foi a divergência entre as duas pontas que fez o artefato
 * ser publicado sem as dependências que ele importava.
 */
const RUNS_FROM_DISK = ['@node-rs/argon2', '@fastify/swagger-ui', 'pino', 'pino-pretty'];

/**
 * Bundle único em ESM.
 *
 * O alvo é o AWS Lambda (Node 24 LTS, arm64): um só arquivo reduz o tempo de
 * cold start e encolhe o artefato.
 *
 * O `noExternal` é o que torna isso verdade. Por padrão o tsup trata tudo que
 * está em `dependencies` como externo, e o resultado é um arquivo que *parece*
 * um bundle mas ainda importa dezenas de pacotes ausentes do artefato. A função
 * morre no carregamento do módulo, antes da primeira requisição, com
 * `ERR_MODULE_NOT_FOUND` — e nenhum teste unitário toca nesse caminho, porque
 * eles importam o código-fonte, não o artefato.
 */
export default defineConfig({
  entry: ['src/main/server.ts', 'src/main/lambda.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
  external: RUNS_FROM_DISK,
  // Sem isto o tsup externaliza todo o `dependencies` e o artefato sai quebrado.
  noExternal: [new RegExp(`^(?!(?:${RUNS_FROM_DISK.join('|')})(?:/|$)).+`)],
  // Parte da árvore de dependências ainda é CommonJS. Ao embutir esse código em
  // uma saída ESM, o esbuild troca cada `require` por um substituto que lança
  // "Dynamic require of X is not supported" — inclusive para módulos nativos do
  // Node. Reintroduzir um `require` real faz o substituto delegar a ele.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

import { defineConfig } from 'tsup';

/**
 * Bundle único em ESM.
 *
 * O alvo é o AWS Lambda (Node 24 LTS, arm64): um só arquivo reduz o tempo de cold
 * start e dispensa `node_modules` no artefato.
 *
 * O entrypoint `src/main/lambda.ts` entra junto com a infraestrutura (issue #10).
 */
export default defineConfig({
  entry: ['src/main/server.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
});

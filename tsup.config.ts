import { defineConfig } from 'tsup';

/**
 * Bundle único em ESM.
 *
 * O alvo é o AWS Lambda (Node 24 LTS, arm64): um só arquivo reduz o tempo de cold
 * start e dispensa `node_modules` no artefato.
 *
 * O `@node-rs/argon2` fica de fora do pacote porque é módulo nativo: o binário
 * é escolhido por plataforma e não pode ser embutido em um arquivo de
 * JavaScript. Ele viaja como dependência instalada, e o script de empacotamento
 * resolve a versão de `linux-arm64` mesmo quando o build roda em outro sistema.
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
  external: ['@node-rs/argon2'],
});

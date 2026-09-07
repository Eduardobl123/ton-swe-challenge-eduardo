import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

/**
 * Cobertura consolidada das três suítes.
 *
 * O relatório da suíte unitária, sozinho, mente nas duas direções: exclui os
 * adaptadores do DynamoDB (provados pela integração) e não enxerga nada que só
 * a jornada percorre. Somar as três em uma execução única evita tanto o número
 * inflado quanto o número pessimista — e evita também mesclar relatórios
 * `lcov` de execuções separadas, que produz um arquivo que ninguém consegue
 * conferir a olho.
 *
 * Precisa de `docker compose up`: integração e ponta a ponta falam com o
 * DynamoDB Local.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/**/*.test.ts'],
      coverage: {
        reportsDirectory: 'coverage',
        exclude: [
          'src/**/*.d.ts',
          // Só os entrypoints. Eles executam no import, e o que provam — que o
          // artefato sobe de verdade — é papel de `npm run verify:lambda`, que
          // roda o pacote publicado dentro do runtime oficial da AWS.
          'src/main/server.ts',
          'src/main/lambda.ts',
        ],
        thresholds: {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
          'src/domain/**/*.ts': { lines: 95, functions: 95, branches: 95, statements: 95 },
          'src/application/**/*.ts': { lines: 95, functions: 95, branches: 95, statements: 95 },
        },
      },
    },
  }),
);

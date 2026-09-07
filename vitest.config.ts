import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Um espião que sobrevive ao teste que o instalou é fonte clássica de
    // falha intermitente, e a ordem de execução esconde o problema.
    restoreMocks: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Apenas os entrypoints ficam de fora: eles executam no import e são
        // exercitados pelos testes ponta a ponta (issue #13). O composition root
        // tem lógica própria e é coberto por teste unitário.
        'src/main/server.ts',
        'src/main/lambda.ts',
        // Os adaptadores DynamoDB são provados pela suíte de integração, contra
        // o banco de verdade: o que importa neles — condição de escrita,
        // incremento atômico, transação — não existe em duplo. Contá-los aqui
        // faria o relatório da suíte unitária mentir nas duas direções.
        // A consolidação dos dois relatórios é a issue #13.
        'src/infrastructure/persistence/dynamodb/**',
      ],
      /**
       * O núcleo (domínio + aplicação) tem o gate alto porque é código puro,
       * sem I/O — não existe desculpa para não cobrir. Adaptadores ficam com os
       * testes de integração e e2e (issues #7 e #13).
       */
      thresholds: {
        'src/domain/**/*.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/application/**/*.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});

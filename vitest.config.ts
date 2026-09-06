import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Composition root e entrypoints: sem lógica própria, cobertos pelos testes e2e (issue #13).
        'src/main/**',
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

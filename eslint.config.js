import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

/**
 * A regra que realmente importa aqui é `boundaries/dependencies`.
 *
 * Arquitetura hexagonal só se sustenta se a dependência apontar sempre para
 * dentro: o domínio no centro, sem conhecer ninguém; a aplicação conhecendo o
 * domínio; a infraestrutura implementando as portas; e o `main` amarrando tudo.
 * Sem um lint que falhe, isso vira apenas um parágrafo no README e a primeira
 * `import` apressada de um cliente DynamoDB dentro de um caso de uso passa
 * despercebida na revisão.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'infra/**',
      '.claude/**',
      'docs/**',
      '*.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      // Promise ignorada é a principal fonte de bug difícil de reproduzir numa API de I/O.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  /* ------------------------------------------------------------------ *
   * Fronteira 1 — direção da dependência entre as camadas.
   * ------------------------------------------------------------------ */
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/**/*', partialMatch: false },
        { type: 'application', pattern: 'src/application/**/*', partialMatch: false },
        { type: 'infrastructure', pattern: 'src/infrastructure/**/*', partialMatch: false },
        { type: 'main', pattern: 'src/main/**/*', partialMatch: false },
      ],
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Violação de fronteira: {{from.type}} não pode importar {{to.type}}. Na arquitetura hexagonal a dependência aponta sempre para dentro — inverta o sentido com uma porta em src/domain/ports.',
          policies: [
            // O domínio é o centro: não conhece nem a camada de aplicação.
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { type: 'domain' } } },
            },
            // A aplicação orquestra o domínio através das portas.
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: { anyOf: ['domain', 'application'] } } } },
            },
            // Adaptadores implementam as portas; enxergam domínio e aplicação.
            {
              from: { element: { type: 'infrastructure' } },
              allow: {
                to: { element: { types: { anyOf: ['domain', 'application', 'infrastructure'] } } },
              },
            },
            // O composition root é o único ponto que enxerga tudo.
            {
              from: { element: { type: 'main' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['domain', 'application', 'infrastructure', 'main'] },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------ *
   * Fronteira 2 — o núcleo não depende de pacote de terceiros.
   *
   * Complementa a regra acima, que cuida apenas de arquivos do projeto. Sem
   * isto, nada impede um `import { z } from 'zod'` dentro de uma entidade, e o
   * domínio deixa de ser testável sem o resto do mundo. Módulos nativos do Node
   * (prefixo `node:`) continuam liberados por serem parte da linguagem.
   * ------------------------------------------------------------------ */
  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/)(?!node:).+',
              message:
                'O núcleo (domain/application) não depende de pacotes de terceiros. Defina uma porta em src/domain/ports e implemente o adaptador em src/infrastructure.',
            },
          ],
        },
      ],
    },
  },

  /* Entrypoints: escrevem no stdout antes do logger estruturado existir (issue #9). */
  {
    files: ['src/main/server.ts', 'src/main/lambda.ts'],
    rules: { 'no-console': 'off' },
  },

  /* Testes: montam qualquer camada e usam fakes livremente. */
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  prettier,
);

import { execFileSync } from 'node:child_process';
import { cpSync, globSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Monta o artefato do Lambda.
 *
 * O bundle sozinho não basta. O `@node-rs/argon2` é módulo nativo: o binário é
 * escolhido por plataforma e não cabe dentro de um arquivo de JavaScript. Como
 * o build costuma rodar em macOS e a função roda em `linux/arm64`, instalar as
 * dependências do jeito normal levaria o binário errado — e o erro só apareceria
 * na primeira invocação, não no empacotamento.
 *
 * É exatamente o risco que o ADR 0007 registrou. A resolução por plataforma
 * explícita é a mitigação.
 */
const STAGING = 'dist/lambda-package';
const PLATFORM = { os: 'linux', cpu: 'arm64', libc: 'glibc' } as const;

function run(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, { stdio: 'inherit', ...(cwd === undefined ? {} : { cwd }) });
}

function main(): void {
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });

  console.log('Compilando o pacote…');
  run('npm', ['run', 'build']);
  cpSync('dist/lambda.js', join(STAGING, 'index.mjs'));

  // Sem `type: module`, o Node trataria o arquivo como CommonJS e a importação
  // falharia em tempo de execução. A extensão `.mjs` já resolveria, mas o
  // manifesto também declara a dependência nativa.
  writeFileSync(
    join(STAGING, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ton-swe-challenge-lambda',
        private: true,
        type: 'module',
        dependencies: { '@node-rs/argon2': readVersion() },
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Resolvendo o binário nativo para ${PLATFORM.os}/${PLATFORM.cpu}…`);
  run(
    'npm',
    [
      'install',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      `--os=${PLATFORM.os}`,
      `--cpu=${PLATFORM.cpu}`,
      // Sem informar a biblioteca C, o npm ignora o pacote de plataforma e o
      // artefato sai sem binário nenhum. A função só falharia na primeira
      // invocação, e não no empacotamento.
      `--libc=${PLATFORM.libc}`,
    ],
    STAGING,
  );

  assertNativeBinary();

  console.log(`Pronto: ${STAGING}`);
  console.log('O Terraform empacota este diretório em zip a partir de infra/envs/<ambiente>.');
}

/**
 * Confere que o binário nativo entrou no artefato.
 *
 * Sem esta checagem o empacotamento termina em sucesso com um pacote incompleto,
 * e a falha aparece só quando a primeira requisição tenta verificar uma senha —
 * em produção, com a implantação já feita.
 */
function assertNativeBinary(): void {
  const encontrados = globSync(`${STAGING}/node_modules/@node-rs/**/*.node`);

  if (encontrados.length === 0) {
    throw new Error(
      'O artefato saiu sem o binário do argon2. Confira os sinalizadores de plataforma do npm.',
    );
  }

  console.log(`Binário nativo: ${encontrados[0] ?? ''}`);
}

/** A versão vem do manifesto do projeto, para não divergir do que os testes usam. */
function readVersion(): string {
  const manifest = JSON.parse(
    execFileSync(
      'node',
      ['-e', 'process.stdout.write(require("fs").readFileSync("package.json"))'],
      {
        encoding: 'utf8',
      },
    ),
  ) as { dependencies: Record<string, string> };

  return manifest.dependencies['@node-rs/argon2'] ?? 'latest';
}

main();

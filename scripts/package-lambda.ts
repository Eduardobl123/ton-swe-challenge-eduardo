import { execFileSync } from 'node:child_process';
import { cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isBuiltin } from 'node:module';
import { join, resolve } from 'node:path';

/**
 * Monta o artefato do Lambda.
 *
 * O bundle sozinho não basta. Alguns pacotes leem arquivos reais do disco em
 * tempo de execução — binário nativo, asset estático, script de worker — e por
 * isso ficam fora do bundle (ver `tsup.config.ts`). Eles precisam viajar como
 * dependência instalada, resolvida para `linux/arm64` mesmo quando o build roda
 * em macOS.
 *
 * A lista de quem fica de fora **não** é repetida aqui. Ela é lida do próprio
 * bundle, porque a versão anterior deste script mantinha uma cópia da lista e as
 * duas divergiram: o bundle importava dezesseis pacotes e o manifesto declarava
 * um. O artefato subia, e a função morria no carregamento do módulo com
 * `ERR_MODULE_NOT_FOUND` — sem que nenhum teste percebesse, porque todos
 * importam o código-fonte, não o artefato.
 */
const STAGING = 'dist/lambda-package';
const BUNDLE = 'dist/lambda.js';
const PLATFORM = { os: 'linux', cpu: 'arm64', libc: 'glibc' } as const;

function run(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, { stdio: 'inherit', ...(cwd === undefined ? {} : { cwd }) });
}

function main(): void {
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });

  console.log('Compilando o pacote…');
  run('npm', ['run', 'build']);
  cpSync(BUNDLE, join(STAGING, 'index.mjs'));

  const dependencies = dependenciesRequiredBy(BUNDLE);
  const nomes = Object.keys(dependencies);
  console.log(
    nomes.length === 0
      ? 'O bundle não importa nenhum pacote externo.'
      : `O bundle ainda importa: ${nomes.join(', ')}`,
  );

  // Sem `type: module`, o Node trataria o arquivo como CommonJS e a importação
  // falharia em tempo de execução. A extensão `.mjs` já resolveria, mas o
  // manifesto também declara as dependências que sobraram.
  writeFileSync(
    join(STAGING, 'package.json'),
    `${JSON.stringify(
      { name: 'ton-swe-challenge-lambda', private: true, type: 'module', dependencies },
      null,
      2,
    )}\n`,
  );

  console.log(`Resolvendo dependências para ${PLATFORM.os}/${PLATFORM.cpu}…`);
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

  assertImportsResolve(nomes);
  assertNativeBinary();

  console.log(`Pronto: ${STAGING}`);
  console.log('O Terraform empacota este diretório em zip a partir de infra/envs/<ambiente>.');
  console.log('Para provar que o artefato sobe de verdade: npm run verify:lambda');
}

/**
 * Descobre o que o bundle ainda importa e casa com a versão do projeto.
 *
 * Ler o artefato, e não uma lista escrita à mão, é o que impede a divergência:
 * qualquer pacote que passe a ficar fora do bundle entra no manifesto sozinho.
 * Uma dependência importada mas não declarada no `package.json` do projeto é
 * erro de empacotamento, não algo a resolver com `latest`.
 */
function dependenciesRequiredBy(bundlePath: string): Record<string, string> {
  const codigo = readFileSync(bundlePath, 'utf8');
  const declaradas = manifest().dependencies;
  const dependencias: Record<string, string> = {};

  for (const especificador of bareSpecifiers(codigo)) {
    const pacote = packageNameOf(especificador);
    const versao = declaradas[pacote];

    if (versao === undefined) {
      throw new Error(
        `O bundle importa "${especificador}", que não está em dependencies do package.json. ` +
          'Declare a dependência ou embuta o pacote no bundle.',
      );
    }

    dependencias[pacote] = versao;
  }

  return Object.fromEntries(Object.entries(dependencias).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Especificadores de pacote — sem caminho relativo e sem módulo do próprio Node. */
function bareSpecifiers(codigo: string): ReadonlySet<string> {
  const encontrados = new Set<string>();

  for (const [, especificador = ''] of codigo.matchAll(
    /(?:^|[\s;}])(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
  )) {
    if (especificador.startsWith('.') || isBuiltin(especificador)) {
      continue;
    }

    encontrados.add(especificador);
  }

  return encontrados;
}

/** `@escopo/nome/subcaminho` pertence ao pacote `@escopo/nome`. */
function packageNameOf(especificador: string): string {
  const partes = especificador.split('/');

  return especificador.startsWith('@')
    ? partes.slice(0, 2).join('/')
    : (partes[0] ?? especificador);
}

/**
 * Confere que cada pacote importado pelo bundle existe dentro do artefato.
 *
 * É a checagem que faltava. Sem ela o empacotamento termina em sucesso com um
 * artefato que não carrega, e a falha só aparece depois do deploy — em toda
 * invocação, porque acontece no carregamento do módulo.
 */
function assertImportsResolve(nomes: readonly string[]): void {
  const require = createRequire(join(resolve(STAGING), 'index.mjs'));
  const ausentes = nomes.filter((nome) => {
    try {
      require.resolve(`${nome}/package.json`);
      return false;
    } catch {
      // Nem todo pacote expõe o `package.json` em `exports`; cair para o próprio
      // nome evita acusar ausência de quem só restringiu o que publica.
      try {
        require.resolve(nome);
        return false;
      } catch {
        return true;
      }
    }
  });

  if (ausentes.length > 0) {
    throw new Error(
      `O artefato não contém pacotes que o bundle importa: ${ausentes.join(', ')}. ` +
        'A função falharia no carregamento do módulo, em toda invocação.',
    );
  }

  console.log(`Dependências presentes no artefato: ${nomes.length}`);
}

/**
 * Confere que o binário nativo entrou no artefato.
 *
 * Instalar o pacote não garante o binário: sem os sinalizadores de plataforma o
 * npm resolve a dependência opcional errada e o artefato sai com o JavaScript e
 * sem o `.node`. A falha apareceria na primeira verificação de senha.
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

/** O manifesto do projeto é a fonte das versões, para não divergir dos testes. */
function manifest(): { dependencies: Record<string, string> } {
  return JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
  };
}

main();

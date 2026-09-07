import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Prova que o artefato do Lambda sobe.
 *
 * Nenhum teste unitário ou de integração toca neste caminho: todos importam o
 * código-fonte, enquanto o que vai para a AWS é o bundle mais o `node_modules`
 * montado pelo empacotamento. Entre os dois cabem falhas que não aparecem em
 * lugar nenhum antes do deploy, e que quebram **toda** invocação porque
 * acontecem no carregamento do módulo:
 *
 * - pacote importado pelo bundle e ausente do artefato (`ERR_MODULE_NOT_FOUND`);
 * - dependência CommonJS embutida em saída ESM (`Dynamic require of "crypto"`);
 * - pacote que lê arquivo do disco e perde os arquivos ao ser embutido
 *   (`__dirname is not defined`).
 *
 * Todas as três já aconteceram neste repositório, e as três passaram por 100% de
 * cobertura sem serem notadas. Por isso a verificação roda o artefato de verdade,
 * dentro da imagem oficial do runtime, e exige resposta HTTP real.
 *
 * O `arm64` é o alvo da função. Em máquina `x86_64` o Docker emula via QEMU, o
 * que deixa a subida lenta mas mantém a verificação fiel à arquitetura publicada.
 */
const ARTIFACT = 'dist/lambda-package';
const IMAGE = 'public.ecr.aws/lambda/nodejs:24';
const CONTAINER = 'ton-challenge-lambda-verify';
const PORT = 9098;
const ENDPOINT = `http://localhost:${PORT}/2015-03-31/functions/function/invocations`;

/** Um cenário por combinação que muda o que o artefato carrega no boot. */
const CENARIOS = [
  { nome: 'documentação desligada, como em produção', swagger: 'false' },
  { nome: 'documentação ligada', swagger: 'true' },
] as const;

const EVENTO = {
  version: '2.0',
  routeKey: 'GET /health',
  rawPath: '/health',
  rawQueryString: '',
  headers: { host: 'verificacao' },
  requestContext: {
    http: {
      method: 'GET',
      path: '/health',
      protocol: 'HTTP/1.1',
      sourceIp: '203.0.113.10',
      userAgent: 'verify-lambda-artifact',
    },
    requestId: 'verificacao',
    stage: '$default',
  },
  isBase64Encoded: false,
};

async function main(): Promise<void> {
  if (!existsSync(ARTIFACT)) {
    falhar(`Artefato ausente em ${ARTIFACT}. Rode "npm run package:lambda" antes.`);
  }

  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    falhar(
      'Docker indisponível. Esta verificação roda o artefato no runtime oficial do Lambda ' +
        'e não tem como ser simulada fora dele.',
    );
  }

  for (const cenario of CENARIOS) {
    await verificar(cenario);
  }

  console.log('\nO artefato sobe e responde no runtime oficial do Lambda.');
}

async function verificar(cenario: (typeof CENARIOS)[number]): Promise<void> {
  console.log(`\n▸ ${cenario.nome}`);
  derrubar();

  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      CONTAINER,
      '--platform',
      'linux/arm64',
      '--publish',
      `${PORT}:8080`,
      '--volume',
      `${resolve(ARTIFACT)}:/var/task:ro`,
      '--env',
      'NODE_ENV=production',
      // A configuração é a de produção, inclusive a persistência: trocá-la por
      // memória mudaria quais clientes o container monta no boot, e é o boot que
      // se quer provar. `/health` responde sem tocar no banco, então nenhuma
      // tabela precisa existir.
      '--env',
      'PERSISTENCE=dynamodb',
      '--env',
      'TABLE_NAME=verificacao',
      '--env',
      'AWS_REGION=us-east-1',
      '--env',
      'JWT_SECRET=chave-de-verificacao-com-mais-de-32-caracteres',
      '--env',
      `SWAGGER_ENABLED=${cenario.swagger}`,
      IMAGE,
      'index.handler',
    ],
    { stdio: 'ignore' },
  );

  try {
    const resposta = await invocarComEspera();

    if (resposta.statusCode !== 200) {
      falhar(
        `O artefato respondeu ${String(resposta.statusCode)} em /health.\n` +
          `Corpo: ${JSON.stringify(resposta).slice(0, 800)}`,
      );
    }

    console.log(`  /health respondeu 200 — ${String(resposta.body).slice(0, 120)}`);
  } finally {
    derrubar();
  }
}

/**
 * O runtime leva alguns segundos para subir, e mais ainda sob emulação. Repetir
 * até um limite distingue "ainda subindo" de "não sobe" — e um erro de
 * carregamento chega como resposta de erro, não como recusa de conexão, então a
 * espera não mascara falha real.
 */
async function invocarComEspera(): Promise<{
  statusCode?: number;
  body?: string;
  errorMessage?: string;
}> {
  const limite = Date.now() + 180_000;
  let ultimoErro = 'sem resposta';

  while (Date.now() < limite) {
    try {
      const resposta = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(EVENTO),
        signal: AbortSignal.timeout(30_000),
      });
      const corpo = (await resposta.json()) as {
        statusCode?: number;
        body?: string;
        errorMessage?: string;
        trace?: readonly string[];
      };

      if (corpo.errorMessage !== undefined) {
        falhar(
          `O artefato falhou ao carregar: ${corpo.errorMessage}\n` +
            `${(corpo.trace ?? []).slice(0, 6).join('\n')}\n\n${logsDoContainer()}`,
        );
      }

      return corpo;
    } catch (erro) {
      ultimoErro = erro instanceof Error ? erro.message : String(erro);
      await new Promise((pronto) => setTimeout(pronto, 1000));
    }
  }

  falhar(`O runtime não respondeu (${ultimoErro}).\n\n${logsDoContainer()}`);
}

function logsDoContainer(): string {
  const logs = spawnSync('docker', ['logs', '--tail', '40', CONTAINER], { encoding: 'utf8' });

  return `Logs do runtime:\n${logs.stdout ?? ''}${logs.stderr ?? ''}`;
}

function derrubar(): void {
  spawnSync('docker', ['rm', '--force', CONTAINER], { stdio: 'ignore' });
}

function falhar(mensagem: string): never {
  derrubar();
  console.error(`\n${mensagem}`);
  process.exit(1);
}

await main();

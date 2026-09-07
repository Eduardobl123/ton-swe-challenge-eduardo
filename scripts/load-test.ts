import autocannon from 'autocannon';
import { Product } from '../src/domain/entities';
import { Money } from '../src/domain/value-objects';
import { buildApp } from '../src/infrastructure/http/app';
import { loadConfig } from '../src/infrastructure/config/env';
import { PinoLogger } from '../src/infrastructure/observability';
import { buildContainer } from '../src/main/container';
import { seedForDevelopment } from '../src/main/dev-seed';
import type { Container } from '../src/main/container';

/**
 * Medição de carga do caminho de leitura.
 *
 * Não entra no CI: número de latência medido em executor compartilhado varia
 * mais do que qualquer regressão que valeria detectar, e um portão que oscila
 * sozinho ensina a ignorar portão. Isto existe para produzir evidência
 * reproduzível para o README, com a máquina e a data registradas junto.
 *
 * São dois cenários porque eles respondem a perguntas diferentes:
 *
 * - com a cota padrão, o que se mede é a **defesa**: 50 conexões simultâneas
 *   contra um limite de 60 por minuto devem virar 429 quase imediatamente, e
 *   recusar precisa ser barato;
 * - com a cota alta, o que se mede é a **capacidade** do caminho de leitura,
 *   sem o limitador escondendo o trabalho real.
 */
const CONEXOES = 50;
const DURACAO_SEGUNDOS = 10;
const PRODUTOS = 200;

interface Cenario {
  readonly nome: string;
  readonly quota: string;
}

const CENARIOS: readonly Cenario[] = [
  { nome: 'cota padrão (60/min)', quota: '60' },
  { nome: 'cota alta (limitador fora do caminho)', quota: '1000000' },
];

async function main(): Promise<void> {
  console.log(
    `Carga: ${String(CONEXOES)} conexões, ${String(DURACAO_SEGUNDOS)}s por cenário, ` +
      `${String(PRODUTOS)} produtos semeados.\n`,
  );

  const linhas: string[] = [];

  for (const cenario of CENARIOS) {
    linhas.push(await medir(cenario));
  }

  console.log('\n| Cenário | req/s | p50 | p99 | 2xx | não-2xx | erros |');
  console.log('| --- | --: | --: | --: | --: | --: | --: |');
  for (const linha of linhas) {
    console.log(linha);
  }
}

async function medir(cenario: Cenario): Promise<string> {
  const config = loadConfig({
    JWT_SECRET: 'um-segredo-de-carga-com-mais-de-trinta-e-dois-caracteres',
    TABLE_NAME: 'carga',
    // A medição é do caminho HTTP e da lógica de paginação. Apontar para um
    // DynamoDB Local em contêiner mediria o contêiner, não a aplicação.
    PERSISTENCE: 'memory',
    SWAGGER_ENABLED: 'false',
    LOG_LEVEL: 'error',
    RATE_LIMIT_PRODUCTS_PER_MINUTE: cenario.quota,
  });
  const container = buildContainer(
    config,
    new PinoLogger({
      level: 'error',
      environment: config.nodeEnv,
      version: config.version,
      pretty: false,
    }),
  );

  await seedForDevelopment(container, { email: 'carga@ton.com.br', password: 'Desafio@Ton2026' });
  await semear(container);

  const app = await buildApp(container);
  const endereco = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'carga@ton.com.br', password: 'Desafio@Ton2026' },
    });
    const { accessToken } = JSON.parse(login.body) as { accessToken: string };

    console.log(`▸ ${cenario.nome}`);

    const resultado = await autocannon({
      url: `${endereco}/v1/products?limit=20`,
      connections: CONEXOES,
      duration: DURACAO_SEGUNDOS,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    // O autocannon agrupa por classe de status, não por código. No cenário de
    // cota padrão praticamente todo não-2xx é 429, que é o ponto da medição.
    const porStatus = resultado as unknown as Record<string, number>;
    const sucesso = porStatus['2xx'] ?? 0;
    const recusadas = resultado.non2xx;

    console.log(
      `  ${String(Math.round(resultado.requests.average))} req/s · ` +
        `p50 ${String(resultado.latency.p50)}ms · p99 ${String(resultado.latency.p99)}ms · ` +
        `2xx ${String(sucesso)} · não-2xx ${String(recusadas)} · erros ${String(resultado.errors)}`,
    );

    return (
      `| ${cenario.nome} | ${String(Math.round(resultado.requests.average))} | ` +
      `${String(resultado.latency.p50)} ms | ${String(resultado.latency.p99)} ms | ` +
      `${String(sucesso)} | ${String(recusadas)} | ${String(resultado.errors)} |`
    );
  } finally {
    await app.close();
  }
}

async function semear(container: Container): Promise<void> {
  const base = container.seeding.clock.now().getTime();

  for (let i = 1; i <= PRODUTOS; i += 1) {
    await container.seeding.products.add(
      Product.create({
        id: `carga-${String(i).padStart(4, '0')}`,
        sku: `CARGA-${String(i).padStart(4, '0')}`,
        name: `Produto ${String(i)}`,
        description: 'Item semeado para medição de carga',
        price: Money.fromCents(1_000 + i),
        active: true,
        createdAt: new Date(base - (PRODUTOS - i) * 1_000),
      }),
    );
  }
}

await main();

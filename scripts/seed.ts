import { Product, User } from '../src/domain/entities';
import { Email, Money } from '../src/domain/value-objects';
import { loadConfig } from '../src/infrastructure/config/env';
import { buildContainer } from '../src/main/container';
import { PinoLogger } from '../src/infrastructure/observability';

/**
 * Carga inicial de dados.
 *
 * O **mesmo** script atende o DynamoDB Local e a AWS real: a diferença é só o
 * `DYNAMODB_ENDPOINT` estar definido ou não. Ter dois scripts faria o de
 * produção ser o que ninguém executa até a hora da entrega, e é exatamente ali
 * que ele falharia.
 *
 * É idempotente. Rodar duas vezes não duplica nada, o que importa porque a
 * carga acontece logo depois de `terraform apply` e é comum repetir o comando
 * quando algo no meio do caminho falhou.
 */
const PRODUCT_COUNT = Number(process.env.SEED_PRODUCT_COUNT ?? '250');
const EMAIL = process.env.SEED_USER_EMAIL ?? 'demo@ton.com.br';
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Desafio@Ton2026';

/**
 * Identificadores derivados do índice, e não sorteados.
 *
 * É o que torna a carga idempotente: a segunda execução tenta gravar as mesmas
 * chaves, e a condição de existência recusa em silêncio.
 */
const productId = (index: number): string => `seed-product-${String(index).padStart(4, '0')}`;
const USER_ID = 'seed-user-0001';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new PinoLogger({
    level: config.log.level,
    environment: config.nodeEnv,
    version: config.version,
    pretty: !config.isProduction,
  });
  // Sem Sentry, de propósito: quem inicializa o SDK é o entrypoint da aplicação
  // (issue #30), e um script de carga não é um. Falha aqui aparece no terminal
  // de quem o rodou, que é onde ela precisa aparecer — encaminhá-la ao painel de
  // erros de produção só somaria ruído.
  const container = buildContainer(config, logger);
  const { users, products, passwordHasher, clock } = container.seeding;

  const destino = config.persistence.endpoint ?? `AWS ${config.persistence.region}`;
  console.log(`Carregando dados em ${config.persistence.tableName} (${destino})…`);

  const now = clock.now();

  // Só grava se ainda não existir. Regravar por cima falharia no controle de
  // concorrência — a versão já teria avançado — e sobrescrever o contador de
  // tentativas de um usuário real seria pior ainda.
  if ((await users.findById(USER_ID)) === null) {
    await users.save(
      User.create({
        id: USER_ID,
        email: Email.create(EMAIL),
        passwordHash: await passwordHasher.hash(PASSWORD),
        failedLoginAttempts: 0,
        lockedUntil: undefined,
        createdAt: now,
        version: 0,
      }),
    );
    console.log(`Usuário ${EMAIL} criado.`);
  } else {
    console.log(`Usuário ${EMAIL} já existia; nada a fazer.`);
  }

  for (let i = 1; i <= PRODUCT_COUNT; i += 1) {
    await products.add(
      Product.create({
        id: productId(i),
        sku: `TON-${String(i).padStart(4, '0')}`,
        name: `Produto ${String(i)}`,
        description: `Item de catálogo número ${String(i)}.`,
        price: Money.fromCents(990 + i * 37),
        // Um em cada vinte fica inativo, para que a listagem tenha o que filtrar
        // e o teste prove que ela filtra.
        active: i % 20 !== 0,
        createdAt: new Date(now.getTime() - (PRODUCT_COUNT - i) * 60_000),
      }),
    );
  }

  console.log(`Pronto: ${String(PRODUCT_COUNT)} produtos no catálogo.`);
  console.log('A senha do usuário demo vem de SEED_USER_PASSWORD.');
}

await main();

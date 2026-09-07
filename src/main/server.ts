import { ValidationError } from '../domain/errors';
import { EnvValidationError, loadConfig } from '../infrastructure/config/env';
import { PinoLogger } from '../infrastructure/observability';
import { buildApp } from '../infrastructure/http/app';
import { buildContainer, type Container } from './container';
import { seedForDevelopment } from './dev-seed';

/**
 * Entrypoint local.
 *
 * Hoje ele valida o ambiente e descreve a configuração resolvida — o suficiente
 * para conferir um `.env` recém-copiado antes de qualquer outra coisa. O
 * servidor HTTP (Fastify) é acoplado aqui na issue #8, e o entrypoint
 * equivalente para o AWS Lambda (`src/main/lambda.ts`) chega na issue #10.
 */
function main(): void {
  let container: Container;

  try {
    const config = loadConfig();
    container = buildContainer(
      config,
      new PinoLogger({
        level: config.log.level,
        environment: config.nodeEnv,
        version: config.version,
        // Formato legível só fora de produção: no Lambda o CloudWatch lê o
        // stdout, e cor de terminal viraria lixo em toda linha.
        pretty: !config.isProduction,
      }),
    );
  } catch (error) {
    // Duas famílias de falha de configuração chegam aqui. O schema recusa valor
    // ausente ou malformado; o domínio recusa combinação incoerente, como um
    // teto de bloqueio menor que a duração base. As duas merecem a mesma
    // mensagem curada: um stack trace do V8 não diz a ninguém qual variável
    // corrigir.
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    if (error instanceof ValidationError) {
      console.error(
        [
          'Configuração de ambiente inconsistente.',
          `  - ${error.field}: ${error.message}`,
          '',
          'Referência completa das variáveis: .env.example',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  }

  void start(container);
}

async function start(container: Container): Promise<void> {
  const { http, nodeEnv, version, isProduction } = container.config;

  // Os adaptadores em memória sobem vazios. Sem a carga, subir a aplicação
  // entregaria uma API que ninguém consegue exercitar à mão. A persistência
  // real e o script de carga chegam na issue #7.
  if (!isProduction) {
    await seedForDevelopment(container, {
      email: process.env.SEED_USER_EMAIL ?? 'demo@ton.com.br',
      password: process.env.SEED_USER_PASSWORD ?? 'Desafio@Ton2026',
    });
  }

  const app = await buildApp(container);

  try {
    await app.listen({ port: http.port, host: '0.0.0.0' });
  } catch (error) {
    console.error('Falha ao subir o servidor:', error);
    process.exitCode = 1;
    return;
  }

  console.log(`API no ar em http://localhost:${String(http.port)}`);
  console.log(`  ambiente ......... ${nodeEnv} (versão ${version})`);
  if (container.config.http.swaggerEnabled) {
    console.log(`  documentação ..... http://localhost:${String(http.port)}/docs`);
  }
  if (!isProduction) {
    console.log('  usuário demo ..... demo@ton.com.br / Desafio@Ton2026');
  }
}

main();

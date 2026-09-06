import { EnvValidationError, loadConfig } from '../infrastructure/config/env';
import { buildContainer } from './container';

/**
 * Entrypoint local.
 *
 * Hoje ele valida o ambiente e descreve a configuração resolvida — o suficiente
 * para conferir um `.env` recém-copiado antes de qualquer outra coisa. O
 * servidor HTTP (Fastify) é acoplado aqui na issue #8, e o entrypoint
 * equivalente para o AWS Lambda (`src/main/lambda.ts`) chega na issue #10.
 */
function main(): void {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const container = buildContainer(config);
  const { persistence, http, nodeEnv, version } = container.config;

  console.log('Configuração validada com sucesso.');
  console.log(`  ambiente ......... ${nodeEnv} (versão ${version})`);
  console.log(`  porta HTTP ....... ${String(http.port)}`);
  console.log(`  tabela DynamoDB .. ${persistence.tableName} @ ${persistence.region}`);
  console.log(`  endpoint local ... ${persistence.endpoint ?? '(AWS real)'}`);
  console.log('');
  console.log('O servidor HTTP entra em serviço na issue #8.');
}

main();

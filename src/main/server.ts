import { ValidationError } from '../domain/errors';
import { EnvValidationError, loadConfig } from '../infrastructure/config/env';
import { buildContainer, type Container } from './container';

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
    container = buildContainer(loadConfig());
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

  const { persistence, http, nodeEnv, version } = container.config;
  const { lockout } = container.policies;

  console.log('Configuração validada com sucesso.');
  console.log(`  ambiente ......... ${nodeEnv} (versão ${version})`);
  console.log(`  porta HTTP ....... ${String(http.port)}`);
  console.log(`  tabela DynamoDB .. ${persistence.tableName} @ ${persistence.region}`);
  console.log(`  endpoint local ... ${persistence.endpoint ?? '(AWS real)'}`);
  console.log(
    `  bloqueio ......... após ${String(lockout.maxAttempts)} falhas, ` +
      `de ${String(lockout.lockDurationMs(lockout.maxAttempts) / 1000)}s ` +
      `até ${String(lockout.maxDelayMs / 1000)}s`,
  );
  console.log('');
  console.log('O servidor HTTP entra em serviço na issue #8.');
}

main();

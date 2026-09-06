import { AppError } from './app-error';

/**
 * Uma escrita perdeu a corrida para outra concorrente.
 *
 * Levantado pelos repositórios quando a versão do registro em disco divergiu da
 * versão que a aplicação leu — no DynamoDB, uma `ConditionExpression` que falha
 * (issue #7). Sem isso, dois logins errados simultâneos poderiam sobrescrever o
 * contador de tentativas e anular o bloqueio de conta.
 *
 * Não estende `DomainError` porque não é regra de negócio: é a persistência
 * dizendo que o estado mudou embaixo. O chamador decide o que fazer, e no login
 * a decisão é **não** tentar de novo — repetir uma tentativa malsucedida
 * ajudaria quem está atacando.
 */
export class ConcurrencyError extends AppError {
  constructor(
    public readonly entity: string,
    public readonly entityId: string,
  ) {
    super('CONCURRENT_MODIFICATION', `Escrita concorrente detectada em ${entity}.`, {
      entity,
      entityId,
    });
  }
}

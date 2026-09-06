import { AppError } from '../../domain/errors';

/**
 * O cliente excedeu a cota de requisições da janela atual.
 *
 * Vive na camada de aplicação, e não no domínio, de propósito: limitar taxa é
 * política operacional, não regra de negócio. Nenhuma entidade fica diferente
 * por causa dele, e trocar o algoritmo ou desligar o limite não altera o que a
 * aplicação significa.
 *
 * Estende `AppError` — e não `DomainError` — pelo mesmo motivo, mas compartilha
 * a base para que o tratamento de erro na borda o processe como qualquer outro
 * erro previsto (issue #8).
 */
export class RateLimitExceededError extends AppError {
  constructor(
    /** Quando a cota se renova. Vira o cabeçalho `Retry-After`. */
    public readonly resetAt: Date,
    /** Limite configurado para a janela, exposto em `RateLimit-Limit`. */
    public readonly limit: number,
  ) {
    super('RATE_LIMIT_EXCEEDED', 'Limite de requisições excedido.', {
      resetAt: resetAt.toISOString(),
      limit,
    });
  }
}

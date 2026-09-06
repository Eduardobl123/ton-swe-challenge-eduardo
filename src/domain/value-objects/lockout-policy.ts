import { ValidationError } from '../errors';

/**
 * Expoente máximo do backoff.
 *
 * Sem teto, `2 ** n` estoura o intervalo seguro de inteiros depois de algumas
 * dezenas de tentativas e o cálculo do bloqueio passa a devolver `Infinity`.
 * Como o resultado é limitado por `maxDelayMs` de qualquer forma, saturar o
 * expoente cedo não muda o comportamento observável.
 */
const MAX_EXPONENT = 20;

export interface LockoutPolicyInput {
  /** Tentativas malsucedidas toleradas antes do primeiro bloqueio. */
  readonly maxAttempts: number;
  /** Duração do primeiro bloqueio, em milissegundos. */
  readonly baseDelayMs: number;
  /** Teto da duração do bloqueio, em milissegundos. */
  readonly maxDelayMs: number;
}

/**
 * Política de bloqueio progressivo de conta.
 *
 * Os três valores vêm do ambiente (`LOCKOUT_MAX_ATTEMPTS`,
 * `LOCKOUT_BASE_DELAY_MS`, `LOCKOUT_MAX_DELAY_MS`) e são montados no composition
 * root, de modo que a regra fica no domínio e a calibragem fica em configuração.
 *
 * O teto não é detalhe de ajuste fino, é o que impede o mecanismo de proteção de
 * virar ferramenta de ataque: sem ele, o bloqueio cresce indefinidamente e
 * qualquer pessoa consegue deixar a conta de outra inacessível por dias apenas
 * errando a senha. Ver ADR 0010.
 *
 * A progressão, com os valores padrão, é 30s, 1min, 2min, 4min, 8min e 15min
 * daí em diante.
 */
export class LockoutPolicy {
  private constructor(
    public readonly maxAttempts: number,
    public readonly baseDelayMs: number,
    public readonly maxDelayMs: number,
  ) {}

  /**
   * @throws {ValidationError} se algum limite for inválido ou incoerente.
   */
  public static create({
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
  }: LockoutPolicyInput): LockoutPolicy {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new ValidationError('maxAttempts', 'Número de tentativas deve ser inteiro positivo.');
    }

    if (!Number.isInteger(baseDelayMs) || baseDelayMs < 1) {
      throw new ValidationError('baseDelayMs', 'Duração base deve ser inteiro positivo.');
    }

    if (!Number.isInteger(maxDelayMs) || maxDelayMs < 1) {
      throw new ValidationError('maxDelayMs', 'Duração máxima deve ser inteiro positivo.');
    }

    if (maxDelayMs < baseDelayMs) {
      throw new ValidationError(
        'maxDelayMs',
        'Duração máxima do bloqueio não pode ser menor que a duração base.',
      );
    }

    return new LockoutPolicy(maxAttempts, baseDelayMs, maxDelayMs);
  }

  /** Indica se a quantidade de falhas acumuladas já dispara bloqueio. */
  public shouldLock(failedAttempts: number): boolean {
    return failedAttempts >= this.maxAttempts;
  }

  /**
   * Duração do bloqueio para a quantidade de falhas informada.
   *
   * Devolve zero enquanto o limite não foi atingido, e a partir daí dobra a cada
   * nova falha, respeitando o teto.
   */
  public lockDurationMs(failedAttempts: number): number {
    if (!this.shouldLock(failedAttempts)) {
      return 0;
    }

    const exponent = Math.min(failedAttempts - this.maxAttempts, MAX_EXPONENT);

    return Math.min(this.baseDelayMs * 2 ** exponent, this.maxDelayMs);
  }
}

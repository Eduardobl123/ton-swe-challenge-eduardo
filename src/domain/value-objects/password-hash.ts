import { ValidationError } from '../errors';

const REDACTED = '[REDACTED]';

/**
 * Hash de senha, opaco por padrão.
 *
 * O tipo existe por um motivo só: tornar difícil vazar o hash por acidente. Um
 * `string` cru acaba em log estruturado, em resposta de erro e em mensagem de
 * depuração sem que ninguém perceba — e um hash vazado é material de ataque
 * offline, ainda que caro (ADR 0007).
 *
 * Os três caminhos por onde um valor costuma escapar sem intenção estão
 * fechados: serialização JSON, conversão para texto e inspeção do Node, usada
 * tanto pelo `console.log` quanto pelo modo legível do logger. Todos devolvem
 * `[REDACTED]`.
 *
 * Ler o valor de verdade exige `.value`, que é explícito e fácil de auditar em
 * revisão. A redaction do logger (issue #9) continua sendo necessária: esta
 * classe é a segunda linha de defesa, não a única.
 */
export class PasswordHash {
  private constructor(public readonly value: string) {}

  /**
   * @throws {ValidationError} se o hash vier vazio.
   */
  public static create(raw: string): PasswordHash {
    if (raw.trim().length === 0) {
      throw new ValidationError('passwordHash', 'Hash de senha não pode ser vazio.');
    }

    return new PasswordHash(raw);
  }

  public toString(): string {
    return REDACTED;
  }

  public toJSON(): string {
    return REDACTED;
  }

  /** Usado por `console.log` e pelo `util.inspect` do Node. */
  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

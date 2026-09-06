import { ValidationError } from '../errors';

/** Limites da RFC 5321: 64 caracteres na parte local, 254 no endereço inteiro. */
const MAX_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

/**
 * Validação deliberadamente conservadora.
 *
 * Não existe expressão regular que aceite exatamente o conjunto de endereços
 * válidos da RFC 5322 — as que tentam são ilegíveis e ainda erram. O objetivo
 * aqui é barrar entrada obviamente malformada; a prova real de que um endereço
 * existe é o e-mail chegar, não a expressão passar.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Endereço de e-mail normalizado.
 *
 * A normalização importa mais do que parece: sem ela, `Maria@Ton.com.br` e
 * `maria@ton.com.br` viram duas contas distintas, e o login passa a depender de
 * como a pessoa digitou. Como o e-mail também é a chave de busca no índice
 * (ADR 0003), a forma canônica precisa ser decidida em um lugar só — aqui.
 */
export class Email {
  private constructor(public readonly value: string) {}

  /**
   * @throws {ValidationError} se o endereço for malformado ou exceder os limites.
   */
  public static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();

    if (normalized.length === 0) {
      throw new ValidationError('email', 'E-mail é obrigatório.');
    }

    if (normalized.length > MAX_LENGTH) {
      throw new ValidationError('email', `E-mail excede ${String(MAX_LENGTH)} caracteres.`);
    }

    if (!SHAPE.test(normalized)) {
      throw new ValidationError('email', 'E-mail em formato inválido.');
    }

    const [localPart] = normalized.split('@');
    if (localPart !== undefined && localPart.length > MAX_LOCAL_PART_LENGTH) {
      throw new ValidationError(
        'email',
        `A parte local do e-mail excede ${String(MAX_LOCAL_PART_LENGTH)} caracteres.`,
      );
    }

    return new Email(normalized);
  }

  public equals(other: Email): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}

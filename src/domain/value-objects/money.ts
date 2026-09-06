import { ValidationError } from '../errors';

/**
 * Valor monetário representado em centavos inteiros.
 *
 * Ponto flutuante não representa décimos exatamente: `0.1 + 0.2` não é `0.3` em
 * IEEE 754, e um catálogo somado em `number` acumula erro. Guardar centavos
 * inteiros elimina a classe inteira de problema — a conversão para exibição é
 * responsabilidade de quem apresenta, não do domínio.
 */
export class Money {
  private constructor(public readonly cents: number) {}

  /**
   * @throws {ValidationError} se o valor não for inteiro, for negativo ou
   *   ultrapassar o limite seguro de inteiros do JavaScript.
   */
  public static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new ValidationError('price', 'Valor monetário deve ser um inteiro em centavos.');
    }

    if (cents < 0) {
      throw new ValidationError('price', 'Valor monetário não pode ser negativo.');
    }

    if (!Number.isSafeInteger(cents)) {
      throw new ValidationError('price', 'Valor monetário excede o limite representável.');
    }

    return new Money(cents);
  }

  public equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  public toJSON(): number {
    return this.cents;
  }
}

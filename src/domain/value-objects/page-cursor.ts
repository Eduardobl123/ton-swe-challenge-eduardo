import { InvalidCursorError } from '../errors';

/**
 * Teto de tamanho. Um cursor legítimo tem dezenas de bytes; qualquer coisa muito
 * acima disso é engano ou tentativa de abuso, e é mais barato recusar aqui do
 * que decodificar.
 */
const MAX_LENGTH = 2048;

/**
 * Marcador opaco de continuação de página.
 *
 * O domínio trata o cursor como um valor sem estrutura: sabe repassá-lo e
 * compará-lo, e nada além disso. O que existe dentro dele — no DynamoDB, a chave
 * de continuação assinada — é assunto exclusivo do adaptador de persistência
 * (ADR 0004).
 *
 * A opacidade é o que permite trocar a estratégia de paginação, ou até o banco,
 * sem alterar o contrato do caso de uso nem o da API.
 */
export class PageCursor {
  private constructor(public readonly value: string) {}

  /**
   * @throws {InvalidCursorError} se o cursor for vazio ou longo demais.
   */
  public static create(raw: string): PageCursor {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new InvalidCursorError();
    }

    if (trimmed.length > MAX_LENGTH) {
      throw new InvalidCursorError();
    }

    return new PageCursor(trimmed);
  }

  public equals(other: PageCursor): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}

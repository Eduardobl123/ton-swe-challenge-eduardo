import { ValidationError } from '../errors';
import { cloneDate } from '../shared/clone-date';
import type { Money } from '../value-objects';

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const SKU_SHAPE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export interface ProductProps {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly price: Money;
  /** Produtos inativos existem no banco, mas não aparecem na listagem pública. */
  readonly active: boolean;
  readonly createdAt: Date;
}

/**
 * Item do catálogo.
 *
 * A entidade é anêmica de propósito: neste desafio o produto é apenas lido, e
 * inventar comportamento que nenhum caso de uso exercita produziria código sem
 * teste e sem valor. O que ela garante é a invariante — nome presente, preço em
 * centavos inteiros, SKU no formato canônico — para que dado corrompido na
 * persistência falhe ao ser reconstruído, e não três camadas adiante.
 */
export class Product {
  private constructor(private readonly props: ProductProps) {}

  /**
   * @throws {ValidationError} se qualquer invariante for violada.
   */
  public static create(props: ProductProps): Product {
    if (props.id.trim().length === 0) {
      throw new ValidationError('id', 'Identificador do produto é obrigatório.');
    }

    if (!SKU_SHAPE.test(props.sku)) {
      throw new ValidationError(
        'sku',
        'SKU deve ter de 3 a 32 caracteres, usando letras maiúsculas, dígitos e hífen.',
      );
    }

    const name = props.name.trim();
    if (name.length === 0) {
      throw new ValidationError('name', 'Nome do produto é obrigatório.');
    }

    if (name.length > MAX_NAME_LENGTH) {
      throw new ValidationError('name', `Nome excede ${String(MAX_NAME_LENGTH)} caracteres.`);
    }

    if (props.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        'description',
        `Descrição excede ${String(MAX_DESCRIPTION_LENGTH)} caracteres.`,
      );
    }

    return new Product({ ...props, name, createdAt: cloneDate(props.createdAt) });
  }

  public get id(): string {
    return this.props.id;
  }

  public get sku(): string {
    return this.props.sku;
  }

  public get name(): string {
    return this.props.name;
  }

  public get description(): string {
    return this.props.description;
  }

  public get price(): Money {
    return this.props.price;
  }

  public get active(): boolean {
    return this.props.active;
  }

  public get createdAt(): Date {
    return cloneDate(this.props.createdAt);
  }

  public toProps(): ProductProps {
    return { ...this.props, createdAt: cloneDate(this.props.createdAt) };
  }
}

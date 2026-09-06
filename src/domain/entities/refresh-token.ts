import { ValidationError } from '../errors';
import { cloneDate, cloneOptionalDate } from '../shared/clone-date';

export interface RefreshTokenProps {
  readonly id: string;
  readonly userId: string;
  /**
   * Hash SHA-256 do token entregue ao cliente. O valor em claro nunca é
   * persistido: um vazamento do banco não deve render sessões utilizáveis.
   */
  readonly tokenHash: string;
  /**
   * Agrupa todos os tokens descendentes de um mesmo login. É a unidade de
   * revogação quando reuso é detectado.
   */
  readonly familyId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | undefined;
  /** Identificador do token que sucedeu este na rotação. */
  readonly replacedByTokenId: string | undefined;
}

/**
 * Credencial de renovação de sessão, de uso único.
 *
 * O desenho todo existe para transformar roubo de token em evento detectável.
 * Como cada token só vale uma vez, reapresentar um já rotacionado significa que
 * há duas partes com a mesma credencial — e não há como saber qual delas é a
 * legítima. A resposta é derrubar a família inteira (ADR 0006).
 *
 * A expiração é decidida por `expiresAt` e pelo relógio, nunca pela ausência do
 * registro: o TTL do DynamoDB remove itens com atraso de até 48 horas, então
 * confiar nele para autorização deixaria tokens vencidos válidos nesse intervalo.
 */
export class RefreshToken {
  private constructor(private readonly props: RefreshTokenProps) {}

  /**
   * @throws {ValidationError} se algum campo obrigatório vier vazio ou se a
   *   expiração não for posterior à emissão.
   */
  public static create(props: RefreshTokenProps): RefreshToken {
    const required: readonly [keyof RefreshTokenProps, string][] = [
      ['id', props.id],
      ['userId', props.userId],
      ['tokenHash', props.tokenHash],
      ['familyId', props.familyId],
    ];

    for (const [field, value] of required) {
      if (value.trim().length === 0) {
        throw new ValidationError(String(field), `Campo ${String(field)} é obrigatório.`);
      }
    }

    if (props.expiresAt.getTime() <= props.issuedAt.getTime()) {
      throw new ValidationError('expiresAt', 'Expiração deve ser posterior à emissão.');
    }

    return new RefreshToken({
      ...props,
      issuedAt: cloneDate(props.issuedAt),
      expiresAt: cloneDate(props.expiresAt),
      revokedAt: cloneOptionalDate(props.revokedAt),
    });
  }

  public get id(): string {
    return this.props.id;
  }

  public get userId(): string {
    return this.props.userId;
  }

  public get tokenHash(): string {
    return this.props.tokenHash;
  }

  public get familyId(): string {
    return this.props.familyId;
  }

  public get issuedAt(): Date {
    return cloneDate(this.props.issuedAt);
  }

  public get expiresAt(): Date {
    return cloneDate(this.props.expiresAt);
  }

  public get revokedAt(): Date | undefined {
    return cloneOptionalDate(this.props.revokedAt);
  }

  public get replacedByTokenId(): string | undefined {
    return this.props.replacedByTokenId;
  }

  public isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  public isRevoked(): boolean {
    return this.props.revokedAt !== undefined;
  }

  public isRotated(): boolean {
    return this.props.replacedByTokenId !== undefined;
  }

  /** Só um token ativo pode renovar a sessão. */
  public isUsable(now: Date): boolean {
    return !this.isExpired(now) && !this.isRevoked() && !this.isRotated();
  }

  /**
   * Indica que este token já foi consumido antes.
   *
   * Ser apresentado neste estado é o sinal de reuso: ou o token vazou, ou o
   * cliente legítimo repetiu a requisição. Não há como distinguir, e a resposta
   * é a mesma nos dois casos.
   */
  public wasAlreadyUsed(): boolean {
    return this.isRotated() || this.isRevoked();
  }

  public rotateTo(nextTokenId: string): RefreshToken {
    return new RefreshToken({ ...this.props, replacedByTokenId: nextTokenId });
  }

  public revoke(now: Date): RefreshToken {
    if (this.isRevoked()) {
      return this;
    }

    return new RefreshToken({ ...this.props, revokedAt: cloneDate(now) });
  }

  public toProps(): RefreshTokenProps {
    return {
      ...this.props,
      issuedAt: cloneDate(this.props.issuedAt),
      expiresAt: cloneDate(this.props.expiresAt),
      revokedAt: cloneOptionalDate(this.props.revokedAt),
    };
  }
}

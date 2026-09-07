import { RefreshToken } from '../../../domain/entities';
import { keys, toTtl } from './table';

export interface RefreshTokenItem {
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly entity: 'RefreshToken';
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly replacedByTokenId?: string;
  /**
   * Expurgo automático.
   *
   * É limpeza, não autorização: o DynamoDB remove itens com atraso de até 48
   * horas, e confiar nele para decidir validade deixaria tokens vencidos
   * funcionando nesse intervalo. Quem decide é `expiresAt`, no domínio.
   */
  readonly ttl: number;
}

export function toRefreshTokenItem(token: RefreshToken): RefreshTokenItem {
  const props = token.toProps();

  return {
    ...keys.refreshToken(props.tokenHash),
    ...keys.refreshTokenFamily(props.familyId, props.issuedAt, props.id),
    entity: 'RefreshToken',
    id: props.id,
    userId: props.userId,
    tokenHash: props.tokenHash,
    familyId: props.familyId,
    issuedAt: props.issuedAt.toISOString(),
    expiresAt: props.expiresAt.toISOString(),
    ...(props.revokedAt === undefined ? {} : { revokedAt: props.revokedAt.toISOString() }),
    ...(props.replacedByTokenId === undefined
      ? {}
      : { replacedByTokenId: props.replacedByTokenId }),
    ttl: toTtl(props.expiresAt),
  };
}

export function toRefreshToken(item: RefreshTokenItem): RefreshToken {
  return RefreshToken.create({
    id: item.id,
    userId: item.userId,
    tokenHash: item.tokenHash,
    familyId: item.familyId,
    issuedAt: new Date(item.issuedAt),
    expiresAt: new Date(item.expiresAt),
    revokedAt: item.revokedAt === undefined ? undefined : new Date(item.revokedAt),
    replacedByTokenId: item.replacedByTokenId,
  });
}

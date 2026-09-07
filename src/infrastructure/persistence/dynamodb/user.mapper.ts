import { User } from '../../../domain/entities';
import { Email, PasswordHash } from '../../../domain/value-objects';
import { keys } from './table';

export interface UserItem {
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly entity: 'User';
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly failedLoginAttempts: number;
  readonly lockedUntil?: string;
  readonly createdAt: string;
  readonly version: number;
}

/**
 * Tradução entre a entidade e o item gravado.
 *
 * O mapeador existe para que a entidade **nunca** veja `pk`, `sk` ou `gsi1pk`.
 * Se ela visse, trocar o desenho da tabela viraria mudança de domínio, e a
 * fronteira que o resto do projeto sustenta cairia justamente na camada que
 * mais muda.
 *
 * Datas viajam em ISO-8601 porque o formato ordena lexicograficamente na mesma
 * sequência cronológica, que é o que permite usá-las direto na chave de
 * classificação.
 */
export function toUserItem(user: User): UserItem {
  const props = user.toProps();

  return {
    ...keys.user(props.id),
    ...keys.userByEmail(props.email.value),
    entity: 'User',
    id: props.id,
    email: props.email.value,
    passwordHash: props.passwordHash.value,
    failedLoginAttempts: props.failedLoginAttempts,
    ...(props.lockedUntil === undefined ? {} : { lockedUntil: props.lockedUntil.toISOString() }),
    createdAt: props.createdAt.toISOString(),
    version: props.version,
  };
}

export function toUser(item: UserItem): User {
  return User.create({
    id: item.id,
    email: Email.create(item.email),
    passwordHash: PasswordHash.create(item.passwordHash),
    failedLoginAttempts: item.failedLoginAttempts,
    lockedUntil: item.lockedUntil === undefined ? undefined : new Date(item.lockedUntil),
    createdAt: new Date(item.createdAt),
    version: item.version,
  });
}

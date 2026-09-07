/**
 * Desenho da tabela única.
 *
 * Todas as entidades convivem em uma tabela porque os padrões de acesso são
 * poucos e conhecidos de antemão, e nenhum deles exige junção. Uma tabela por
 * entidade multiplicaria o Terraform e as permissões de IAM sem trazer
 * benefício (ADR 0003).
 *
 * As chaves ficam neste arquivo, e não espalhadas pelos repositórios, porque
 * elas **são** o esquema: mudar um prefixo sem mudar os dois lados de uma
 * consulta produz um repositório que não acha nada e não falha em lugar nenhum.
 *
 * | Entidade      | pk                    | sk        | gsi1pk           | gsi1sk               | ttl         |
 * | ------------- | --------------------- | --------- | ---------------- | -------------------- | ----------- |
 * | User          | `USER#<id>`           | `PROFILE` | `EMAIL#<email>`  | `USER`               | —           |
 * | Product       | `PRODUCT#<id>`        | `PROFILE` | `PRODUCT#ACTIVE` | `<criação>#<id>`     | —           |
 * | RefreshToken  | `RT#<hash>`           | `TOKEN`   | `RTFAM#<família>`| `<emissão>#<id>`     | `expiresAt` |
 * | RateLimit     | `RL#<chave>#<janela>` | `COUNTER` | —                | —                    | fim + 60s   |
 */
export const GSI1 = 'gsi1';

export const keys = {
  user: (id: string) => ({ pk: `USER#${id}`, sk: 'PROFILE' }),
  /** O e-mail já chega normalizado pelo objeto de valor, então a chave é estável. */
  userByEmail: (email: string) => ({ gsi1pk: `EMAIL#${email}`, gsi1sk: 'USER' }),

  product: (id: string) => ({ pk: `PRODUCT#${id}`, sk: 'PROFILE' }),
  /**
   * Só produtos ativos entram no índice.
   *
   * Um item inativo simplesmente não tem `gsi1pk`, e o DynamoDB não indexa o que
   * não tem a chave — então a listagem nunca precisa filtrar depois de ler, e
   * não se paga leitura por item que será descartado.
   */
  activeProduct: (createdAt: Date, id: string) => ({
    gsi1pk: 'PRODUCT#ACTIVE',
    gsi1sk: `${createdAt.toISOString()}#${id}`,
  }),

  refreshToken: (tokenHash: string) => ({ pk: `RT#${tokenHash}`, sk: 'TOKEN' }),
  refreshTokenFamily: (familyId: string, issuedAt: Date, id: string) => ({
    gsi1pk: `RTFAM#${familyId}`,
    gsi1sk: `${issuedAt.toISOString()}#${id}`,
  }),

  rateLimit: (key: string, windowStartedAt: number) => ({
    pk: `RL#${key}#${String(windowStartedAt)}`,
    sk: 'COUNTER',
  }),
} as const;

/** Segundos desde a época, que é a unidade que o TTL do DynamoDB espera. */
export function toTtl(instant: Date): number {
  return Math.floor(instant.getTime() / 1000);
}

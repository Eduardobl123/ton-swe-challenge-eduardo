import type { RefreshToken } from '../entities';

/**
 * Persistência dos refresh tokens.
 *
 * A busca é feita pelo hash, e não pelo identificador, porque é o hash que o
 * cliente apresenta — procurar por ele deve ser acesso direto por chave, jamais
 * uma varredura.
 */
export interface RefreshTokenRepository {
  save(token: RefreshToken): Promise<void>;

  /** Devolve `null` quando nenhum token corresponde ao hash. */
  findByHash(tokenHash: string): Promise<RefreshToken | null>;

  /**
   * Marca o token como rotacionado, de forma atômica, e grava o sucessor.
   *
   * A atomicidade é o que sustenta a detecção de reuso. Duas renovações
   * simultâneas com o mesmo token precisam resultar em exatamente uma vitória —
   * caso contrário as duas passariam, e a cópia roubada seria tão válida quanto
   * a legítima.
   *
   * @throws {ConcurrencyError} quando o token já havia sido rotacionado ou
   *   revogado. Para o chamador, perder esta corrida é indistinguível de reuso e
   *   recebe o mesmo tratamento.
   */
  rotate(current: RefreshToken, next: RefreshToken): Promise<void>;

  /**
   * Revoga todos os tokens da família, incluindo os já rotacionados.
   *
   * É a reação ao reuso: derruba a sessão inteira, e não apenas a credencial
   * apresentada.
   */
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

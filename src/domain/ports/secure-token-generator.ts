export interface OpaqueToken {
  /**
   * Valor entregue ao cliente.
   *
   * **Nunca é persistido.** Só o cliente e a resposta que o criou conhecem este
   * texto; o banco guarda apenas o hash.
   */
  readonly value: string;
  /** Hash do valor, que é o que fica gravado e o que serve de chave de busca. */
  readonly hash: string;
}

/**
 * Geração de credencial opaca.
 *
 * Diferente do access token, o refresh token não carrega informação: é um
 * segredo aleatório cujo único significado é existir na base. Isso é o que
 * permite revogá-lo, coisa que um JWT não permite (ADR 0006).
 *
 * Guardar apenas o hash tem a mesma motivação de guardar hash de senha: um
 * vazamento do banco não deve render sessões utilizáveis. A diferença é que
 * aqui o valor original tem entropia máxima, então SHA-256 basta — não há
 * dicionário a percorrer, e o custo de um argon2 por renovação seria
 * desperdício.
 */
export interface SecureTokenGenerator {
  generate(): OpaqueToken;

  /** Hash do valor apresentado pelo cliente, para localizar o registro. */
  hash(value: string): string;
}

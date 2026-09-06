import type { PasswordHash } from '../value-objects';

/**
 * Derivação e verificação de senha.
 *
 * O domínio não sabe qual algoritmo está por trás — a escolha do argon2id e de
 * seus parâmetros é do adaptador (ADR 0007), e trocá-la não deve tocar em regra
 * de negócio.
 *
 * `verify` recebe o hash como parâmetro em vez de buscá-lo: é o que permite
 * verificar contra um hash inerte quando o usuário não existe, equalizando o
 * tempo de resposta para que a duração não revele se o e-mail está cadastrado.
 */
export interface PasswordHasher {
  hash(plainPassword: string): Promise<PasswordHash>;

  /** Devolve falso em vez de lançar quando a senha não confere. */
  verify(plainPassword: string, hash: PasswordHash): Promise<boolean>;
}

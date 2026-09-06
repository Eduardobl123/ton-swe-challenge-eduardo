import type { User } from '../entities';
import type { Email } from '../value-objects';

/**
 * Persistência de usuários.
 *
 * Só existem dois padrões de acesso porque só há dois: autenticar e atualizar o
 * resultado da tentativa. Uma interface genérica de repositório traria métodos
 * que ninguém chama e esconderia o custo real de cada consulta.
 */
export interface UserRepository {
  /** Devolve `null` quando não há usuário com o endereço informado. */
  findByEmail(email: Email): Promise<User | null>;

  /**
   * Grava o usuário condicionado à versão que foi lida.
   *
   * @throws {ConcurrencyError} quando outra escrita alterou o registro no
   *   intervalo. Sem essa condição, duas tentativas de login simultâneas
   *   sobrescreveriam o contador de falhas e anulariam o bloqueio de conta.
   */
  save(user: User): Promise<void>;
}

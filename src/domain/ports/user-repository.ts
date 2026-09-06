import type { User } from '../entities';
import type { Email, LockoutPolicy } from '../value-objects';

/**
 * Persistência de usuários.
 *
 * Só existem três padrões de acesso porque só há três: autenticar, contabilizar
 * uma tentativa malsucedida e limpar o contador depois de um acerto. Uma
 * interface genérica de repositório traria métodos que ninguém chama e
 * esconderia o custo real de cada consulta.
 */
export interface UserRepository {
  /** Devolve `null` quando não há usuário com o endereço informado. */
  findByEmail(email: Email): Promise<User | null>;

  /**
   * Contabiliza uma tentativa malsucedida e devolve o estado resultante.
   *
   * **A operação precisa ser atômica**, e é por isso que ela existe em vez de o
   * caso de uso somar um e chamar `save`. Ler, incrementar e gravar permite que
   * tentativas simultâneas leiam o mesmo contador e gravem por cima umas das
   * outras: cem tentativas em paralelo contariam como uma, e o bloqueio deixaria
   * de valer justamente contra ataque automatizado, que é o caso que ele existe
   * para conter.
   *
   * No DynamoDB isso é `UpdateItem` com `ADD failedLoginAttempts :1` e
   * `ReturnValues: UPDATED_NEW`, decidindo o bloqueio pelo total devolvido
   * (issue #7). O `user` recebido serve para identificar o registro; o contador
   * usado é sempre o que está gravado, nunca o que veio na instância.
   */
  registerFailedLogin(user: User, now: Date, policy: LockoutPolicy): Promise<User>;

  /**
   * Grava o usuário condicionado à versão que foi lida.
   *
   * Usado para zerar o contador depois de uma autenticação bem-sucedida e para
   * a carga inicial de dados.
   *
   * @throws {ConcurrencyError} quando outra escrita alterou o registro no
   *   intervalo.
   */
  save(user: User): Promise<void>;
}

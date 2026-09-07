import { ConcurrencyError } from '../../../domain/errors';
import { User } from '../../../domain/entities';
import type { Email, LockoutPolicy } from '../../../domain/value-objects';
import type { UserRepository } from '../../../domain/ports';

/**
 * Repositório de usuários em memória.
 *
 * Serve ao desenvolvimento local sem Docker e aos testes. Não é um esboço: ele
 * reproduz o **contrato** do adaptador DynamoDB, incluindo a atomicidade do
 * contador de falhas e o controle de concorrência otimista da escrita comum. Um
 * duplo que sempre aceita a escrita esconderia justamente os caminhos que o caso
 * de uso precisa tratar, e o defeito só apareceria contra o banco de verdade.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();

  constructor(seed: readonly User[] = []) {
    for (const user of seed) {
      this.byId.set(user.id, user);
    }
  }

  /** Usado apenas pela carga inicial, que precisa saber se já gravou antes. */
  public findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public findByEmail(email: Email): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email.equals(email)) {
        return Promise.resolve(user);
      }
    }

    return Promise.resolve(null);
  }

  /**
   * Incrementa a partir do valor gravado, e não do que veio na instância.
   *
   * Não há `await` entre a leitura e a escrita, então nenhuma outra tarefa corre
   * no meio: é o equivalente, neste adaptador, ao `ADD` atômico do DynamoDB.
   */
  public registerFailedLogin(user: User, now: Date, policy: LockoutPolicy): Promise<User> {
    const current = this.byId.get(user.id) ?? user;
    const updated = current.recordFailedLogin(now, policy);
    const stored = User.create({ ...updated.toProps(), version: current.version + 1 });

    this.byId.set(stored.id, stored);

    return Promise.resolve(stored);
  }

  /**
   * @throws {ConcurrencyError} quando a versão em memória avançou desde a
   *   leitura, espelhando a `ConditionExpression` do DynamoDB (issue #7).
   */
  public save(user: User): Promise<void> {
    const current = this.byId.get(user.id);

    if (current !== undefined && current.version !== user.version) {
      return Promise.reject(new ConcurrencyError('User', user.id));
    }

    // A versão avança na escrita, como faz a persistência real: quem ainda
    // segura a instância antiga perde a próxima corrida.
    const props = user.toProps();
    this.byId.set(user.id, User.create({ ...props, version: props.version + 1 }));

    return Promise.resolve();
  }
}

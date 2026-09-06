import { ConcurrencyError } from '../../../domain/errors';
import { User } from '../../../domain/entities';
import type { Email } from '../../../domain/value-objects';
import type { UserRepository } from '../../../domain/ports';

/**
 * Repositório de usuários em memória.
 *
 * Serve ao desenvolvimento local sem Docker e aos testes. Não é um esboço: ele
 * reproduz o **contrato** do adaptador DynamoDB, incluindo o controle de
 * concorrência otimista. Um duplo que sempre aceita a escrita esconderia
 * justamente o caminho de erro que o caso de uso precisa tratar, e o defeito só
 * apareceria contra o banco de verdade.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();

  constructor(seed: readonly User[] = []) {
    for (const user of seed) {
      this.byId.set(user.id, user);
    }
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

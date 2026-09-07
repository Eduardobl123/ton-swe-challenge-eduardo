import { ConcurrencyError } from '../../../domain/errors';
import type { RefreshToken } from '../../../domain/entities';
import type { RefreshTokenRepository } from '../../../domain/ports';

/**
 * Persistência de refresh tokens em memória.
 *
 * Reproduz as duas garantias que sustentam a detecção de reuso (ADR 0006), e
 * não apenas guarda objetos.
 *
 * **Rotação atômica.** Duas renovações simultâneas com o mesmo token têm de
 * resultar em exatamente uma vitória. Se as duas passassem, a cópia roubada
 * seria tão válida quanto a legítima e a detecção nunca dispararia — o mesmo
 * tipo de corrida que enfraquecia o contador de bloqueio de conta antes da
 * correção na issue #3.
 *
 * **Revogação por família.** Reagir ao reuso derrubando só o token apresentado
 * deixaria a sessão do atacante viva. A revogação alcança todos os descendentes
 * do mesmo login.
 */
export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byHash = new Map<string, RefreshToken>();

  public save(token: RefreshToken): Promise<void> {
    this.byHash.set(token.tokenHash, token);

    return Promise.resolve();
  }

  public findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return Promise.resolve(this.byHash.get(tokenHash) ?? null);
  }

  /**
   * @throws {ConcurrencyError} quando o token já havia sido rotacionado ou
   *   revogado. Para quem chama, perder esta corrida é indistinguível de reuso e
   *   recebe o mesmo tratamento.
   */
  public rotate(current: RefreshToken, next: RefreshToken): Promise<void> {
    // A leitura e as escritas acontecem sem `await` entre elas, então nenhuma
    // outra tarefa corre no meio. É o equivalente, neste adaptador, à
    // `ConditionExpression` que o DynamoDB usará (issue #7).
    const stored = this.byHash.get(current.tokenHash);

    if (stored === undefined || stored.wasAlreadyUsed()) {
      return Promise.reject(new ConcurrencyError('RefreshToken', current.id));
    }

    this.byHash.set(stored.tokenHash, stored.rotateTo(next.id));
    this.byHash.set(next.tokenHash, next);

    return Promise.resolve();
  }

  public revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const [hash, token] of this.byHash) {
      if (token.familyId === familyId) {
        this.byHash.set(hash, token.revoke(now));
      }
    }

    return Promise.resolve();
  }
}

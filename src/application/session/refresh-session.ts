import {
  ConcurrencyError,
  InvalidRefreshTokenError,
  RefreshTokenReuseDetectedError,
} from '../../domain/errors';
import type {
  Clock,
  Logger,
  RefreshTokenRepository,
  SecureTokenGenerator,
} from '../../domain/ports';
import type { SessionIssuer } from './session-issuer';

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly ipAddress: string | undefined;
}

export interface RefreshSessionOutput {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
}

export interface RefreshSessionDependencies {
  readonly refreshTokens: RefreshTokenRepository;
  readonly secureTokens: SecureTokenGenerator;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Renova a sessão, rotacionando o refresh token.
 *
 * ## O que a rotação compra
 *
 * Cada token vale uma vez só. Isso transforma o **reuso** — apresentar um token
 * já gasto — em sinal claro de que existe uma cópia circulando. Sem rotação, um
 * token roubado funcionaria em silêncio até expirar, e ninguém saberia.
 *
 * Quando o sinal aparece não há como distinguir quem é legítimo: as duas partes
 * têm a mesma credencial. A resposta é derrubar a família inteira e exigir nova
 * autenticação. É agressivo de propósito — entre manter uma sessão possivelmente
 * comprometida e pedir que o usuário entre de novo, a segunda opção é a correta
 * (ADR 0006).
 *
 * ## Uma resposta só
 *
 * Token inexistente, expirado, revogado e reusado terminam no mesmo
 * `InvalidRefreshTokenError`. Distinguir "não existe" de "existe mas expirou"
 * permitiria mapear tokens válidos por tentativa e erro, e avisar que o reuso
 * foi percebido só serviria para alertar quem está atacando.
 */
export class RefreshSession {
  constructor(private readonly deps: RefreshSessionDependencies) {}

  public async execute(input: RefreshSessionInput): Promise<RefreshSessionOutput> {
    try {
      return await this.attempt(input);
    } catch (error) {
      // A conversão acontece em um lugar só. Espalhar o erro genérico por cada
      // ramo funcionaria até alguém acrescentar um ramo novo e esquecer de
      // converter — e o vazamento seria silencioso.
      if (error instanceof RefreshTokenReuseDetectedError) {
        throw new InvalidRefreshTokenError();
      }

      throw error;
    }
  }

  private async attempt(input: RefreshSessionInput): Promise<RefreshSessionOutput> {
    const now = this.deps.clock.now();
    // Busca pelo hash, que é chave: procurar pelo valor apresentado exigiria
    // varrer a tabela, e o valor em claro não está gravado em lugar nenhum.
    const presented = this.deps.secureTokens.hash(input.refreshToken);
    const stored = await this.deps.refreshTokens.findByHash(presented);

    if (stored === null) {
      this.deps.logger.info('auth.refresh.failed', {
        reason: 'unknown_token',
        ipAddress: input.ipAddress,
      });
      throw new InvalidRefreshTokenError();
    }

    if (stored.wasAlreadyUsed()) {
      await this.revokeFamilyAndReport(stored.userId, stored.familyId, now, input.ipAddress);
    }

    if (stored.isExpired(now)) {
      // A expiração é decidida aqui, e não pela ausência do registro: o TTL do
      // DynamoDB remove itens com atraso de até 48 horas, e confiar nele
      // deixaria tokens vencidos válidos nesse intervalo.
      this.deps.logger.info('auth.refresh.failed', {
        reason: 'expired',
        userId: stored.userId,
        ipAddress: input.ipAddress,
      });
      throw new InvalidRefreshTokenError();
    }

    const issued = await this.deps.sessionIssuer.issue(stored.userId, stored.familyId);

    try {
      await this.deps.refreshTokens.rotate(stored, issued.entity);
    } catch (error) {
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }

      // Perder a corrida significa que outra requisição rotacionou o mesmo
      // token primeiro — indistinguível de reuso, e tratado igual. Deixar
      // passar aqui permitiria que duas partes seguissem com sessões válidas
      // derivadas da mesma credencial.
      await this.revokeFamilyAndReport(stored.userId, stored.familyId, now, input.ipAddress);
    }

    this.deps.logger.info('auth.refresh.succeeded', {
      userId: stored.userId,
      familyId: stored.familyId,
      ipAddress: input.ipAddress,
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresIn,
    };
  }

  /**
   * Derruba a sessão inteira e registra o incidente.
   *
   * @throws {RefreshTokenReuseDetectedError} sempre. O tipo específico existe
   *   para que o motivo fique explícito no fluxo e nos testes; `execute` o
   *   converte na resposta genérica antes de sair.
   */
  private async revokeFamilyAndReport(
    userId: string,
    familyId: string,
    now: Date,
    ipAddress: string | undefined,
  ): Promise<never> {
    await this.deps.refreshTokens.revokeFamily(familyId, now);

    // Evento de segurança: identifica usuário e família, jamais o token.
    this.deps.logger.error('auth.refresh.reuse_detected', {
      userId,
      familyId,
      ipAddress,
    });

    throw new RefreshTokenReuseDetectedError(userId, familyId);
  }
}

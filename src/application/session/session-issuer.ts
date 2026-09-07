import { RefreshToken } from '../../domain/entities';
import type {
  Clock,
  IdGenerator,
  RefreshTokenRepository,
  SecureTokenGenerator,
  TokenSigner,
} from '../../domain/ports';

export interface IssuedSession {
  readonly accessToken: string;
  /**
   * Valor em claro do refresh token, o único momento em que ele existe fora do
   * cliente. Vai para a resposta e nunca para o banco nem para o log.
   */
  readonly refreshToken: string;
  /** Validade do access token, em segundos. */
  readonly expiresIn: number;
  /**
   * Entidade correspondente, ainda não gravada.
   *
   * Quem chama decide como persistir: o login grava direto, a renovação grava
   * dentro da rotação atômica, junto com a marcação do token anterior.
   */
  readonly entity: RefreshToken;
}

export interface SessionIssuerDependencies {
  readonly refreshTokens: RefreshTokenRepository;
  readonly tokenSigner: TokenSigner;
  readonly secureTokens: SecureTokenGenerator;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

/**
 * Emissão do par de credenciais de uma sessão.
 *
 * Login e renovação emitem exatamente a mesma coisa, e a única diferença é se a
 * família começa agora ou continua. Duplicar essa lógica nos dois casos de uso
 * seria pedir para que divergissem — bastaria alguém corrigir a validade em um
 * lugar e esquecer o outro.
 *
 * Não é um caso de uso: não realiza intenção de negócio nenhuma sozinho, apenas
 * monta o que os dois precisam entregar.
 */
export class SessionIssuer {
  constructor(private readonly deps: SessionIssuerDependencies) {}

  /**
   * @param familyId Ausente inicia uma família nova, como no login. Informado
   *   mantém a linhagem, o que é o que permite revogar a sessão inteira quando
   *   um reuso é detectado.
   */
  public async issue(userId: string, familyId?: string): Promise<IssuedSession> {
    const now = this.deps.clock.now();
    const opaque = this.deps.secureTokens.generate();

    const refreshToken = RefreshToken.create({
      id: this.deps.idGenerator.next(),
      userId,
      // Só o hash é gravado: um vazamento do banco não deve render sessões.
      tokenHash: opaque.hash,
      familyId: familyId ?? this.deps.idGenerator.next(),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + this.deps.refreshTokenTtlSeconds * 1000),
      revokedAt: undefined,
      replacedByTokenId: undefined,
    });

    const accessToken = await this.deps.tokenSigner.sign(
      { subject: userId },
      this.deps.accessTokenTtlSeconds,
    );

    return {
      accessToken,
      refreshToken: opaque.value,
      expiresIn: this.deps.accessTokenTtlSeconds,
      entity: refreshToken,
    };
  }
}

import type {
  Clock,
  Logger,
  RefreshTokenRepository,
  SecureTokenGenerator,
} from '../../domain/ports';

export interface LogoutInput {
  readonly refreshToken: string;
  /** Usuário autenticado na requisição, dono esperado do token. */
  readonly userId: string;
  readonly ipAddress: string | undefined;
}

export interface LogoutDependencies {
  readonly refreshTokens: RefreshTokenRepository;
  readonly secureTokens: SecureTokenGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Encerra a sessão, revogando a família do refresh token apresentado.
 *
 * ## Por que revoga a família, e não só o token
 *
 * Sair deve encerrar a sessão, não apenas invalidar a última credencial dela.
 * Revogar só o token apresentado deixaria vivos os anteriores da mesma linhagem
 * que ainda não tivessem sido rotacionados.
 *
 * ## O que o logout não faz
 *
 * **O access token emitido continua válido até expirar**, no máximo 15 minutos.
 * É o preço consciente de manter a verificação do JWT sem consultar o banco: uma
 * lista de revogação exigiria uma leitura em toda requisição autenticada,
 * anulando a principal vantagem do formato para fechar uma janela curta. Ver
 * ADR 0006.
 *
 * ## Por que nunca falha
 *
 * Token desconhecido, expirado ou já revogado terminam em sucesso. Sair é uma
 * intenção que o cliente já cumpriu ao descartar a credencial; devolver erro só
 * atrapalharia quem está saindo, e distinguir os casos informaria se um token
 * existe a quem apenas quer descobrir isso.
 *
 * ## Posse
 *
 * O token precisa pertencer a quem está autenticado. Sem essa conferência, a
 * rota exigiria credencial e não usaria a identidade para nada — cerimônia que
 * sugere uma garantia inexistente. Com ela, apresentar o token de outra pessoa
 * vira evento de segurança registrado, do mesmo modo que o reuso na renovação,
 * e nada é revogado.
 */
export class Logout {
  constructor(private readonly deps: LogoutDependencies) {}

  public async execute(input: LogoutInput): Promise<void> {
    const presented = this.deps.secureTokens.hash(input.refreshToken);
    const stored = await this.deps.refreshTokens.findByHash(presented);

    if (stored === null) {
      this.deps.logger.info('auth.logout.unknown_token', { ipAddress: input.ipAddress });
      return;
    }

    if (stored.userId !== input.userId) {
      // Resposta idêntica à do caminho feliz: informar a divergência diria a
      // quem sonda que aquele token existe e a quem pertence.
      this.deps.logger.error('auth.logout.token_owner_mismatch', {
        userId: input.userId,
        tokenOwnerId: stored.userId,
        ipAddress: input.ipAddress,
      });
      return;
    }

    await this.deps.refreshTokens.revokeFamily(stored.familyId, this.deps.clock.now());

    this.deps.logger.info('auth.logout.succeeded', {
      userId: stored.userId,
      familyId: stored.familyId,
      ipAddress: input.ipAddress,
    });
  }
}

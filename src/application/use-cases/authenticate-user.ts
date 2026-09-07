import {
  AccountLockedError,
  ConcurrencyError,
  InvalidCredentialsError,
  ValidationError,
} from '../../domain/errors';
import { Email, type LockoutPolicy, type PasswordHash } from '../../domain/value-objects';
import type { User } from '../../domain/entities';
import type {
  Clock,
  Logger,
  PasswordHasher,
  RefreshTokenRepository,
  UserRepository,
} from '../../domain/ports';
import type { SessionIssuer } from '../session';
import type { AuthenticateUserInput, AuthenticateUserOutput } from '../dto';

/**
 * Teto do tamanho da senha aceito antes de derivar o hash.
 *
 * A borda HTTP já valida o intervalo (issue #8); esta é a segunda linha. Sem
 * teto, um corpo de dezenas de kilobytes seria processado inteiro pelo argon2id,
 * que custa 19 MiB e alguns milissegundos por chamada — um pedido barato de
 * enviar e caro de atender é a receita de uma negação de serviço.
 */
const MAX_PASSWORD_LENGTH = 128;

export interface AuthenticateUserDependencies {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly refreshTokens: RefreshTokenRepository;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly lockoutPolicy: LockoutPolicy;
  /**
   * Hash sem senha correspondente, usado para gastar o mesmo tempo quando não há
   * o que verificar de verdade.
   */
  readonly inertPasswordHash: PasswordHash;
}

/**
 * Autentica um usuário e emite o access token.
 *
 * ## A regra que organiza o caso de uso inteiro
 *
 * **Todo caminho de recusa termina no mesmo `InvalidCredentialsError`**, com o
 * mesmo corpo e um tempo de resposta equivalente. E-mail malformado, e-mail
 * inexistente, senha errada, conta bloqueada e escrita concorrente perdida são
 * indistinguíveis de fora.
 *
 * Isso não é excesso de zelo. Se a conta bloqueada respondesse diferente,
 * bastaria enviar cinco tentativas para descobrir se um endereço tem cadastro, e
 * qualquer pessoa poderia deixar a conta de outra inacessível de propósito. Se a
 * resposta para e-mail inexistente fosse mais rápida, a diferença de tempo
 * entregaria a mesma informação sem nem precisar ler o corpo. Ver ADR 0010.
 *
 * O preço é conhecido: quem errou a senha várias vezes recebe "credenciais
 * inválidas" mesmo digitando a senha certa, sem entender por quê. É uma
 * experiência ruim escolhida de propósito, e o teto de 15 minutos do bloqueio
 * limita a duração.
 *
 * A diferença entre os casos existe, mas só no log — onde é útil para quem opera
 * e inacessível para quem ataca.
 */
export class AuthenticateUser {
  constructor(private readonly deps: AuthenticateUserDependencies) {}

  public async execute(input: AuthenticateUserInput): Promise<AuthenticateUserOutput> {
    try {
      return await this.attempt(input);
    } catch (error) {
      // A conta bloqueada existe como tipo próprio para que a decisão fique
      // explícita no fluxo, mas nunca sai daqui: a resposta é a mesma de senha
      // errada. Ver ADR 0010.
      if (error instanceof AccountLockedError) {
        throw new InvalidCredentialsError();
      }

      throw error;
    }
  }

  private async attempt(input: AuthenticateUserInput): Promise<AuthenticateUserOutput> {
    const now = this.deps.clock.now();

    if (input.password.length > MAX_PASSWORD_LENGTH) {
      // Único caminho que não equaliza o tempo, e de propósito: derivar o hash
      // de uma entrada absurda é exatamente o custo que se quer evitar. O
      // tamanho é escolhido por quem chama e não revela nada sobre a conta.
      this.deps.logger.warn('auth.login.password_too_long', {
        length: input.password.length,
        ipAddress: input.ipAddress,
      });
      throw new InvalidCredentialsError();
    }

    const email = this.parseEmail(input.email);

    if (email === null) {
      await this.burnTime(input.password);
      this.deps.logger.info('auth.login.failed', {
        reason: 'malformed_email',
        ipAddress: input.ipAddress,
      });
      throw new InvalidCredentialsError();
    }

    const user = await this.deps.users.findByEmail(email);

    if (user === null) {
      await this.burnTime(input.password);
      this.deps.logger.info('auth.login.failed', {
        reason: 'unknown_email',
        ipAddress: input.ipAddress,
      });
      throw new InvalidCredentialsError();
    }

    const lockedUntil = user.lockedUntilIfLocked(now);

    if (lockedUntil !== undefined) {
      // A senha não é verificada — não faz sentido gastar argon2 por uma conta
      // bloqueada — mas o tempo é equalizado para que a resposta continue
      // indistinguível de uma senha errada.
      await this.burnTime(input.password);
      this.deps.logger.warn('auth.login.locked', {
        userId: user.id,
        lockedUntil: lockedUntil.toISOString(),
        ipAddress: input.ipAddress,
      });
      throw new AccountLockedError(lockedUntil);
    }

    const matches = await this.deps.passwordHasher.verify(input.password, user.passwordHash);

    if (!matches) {
      await this.registerFailure(user, now, input.ipAddress);
      throw new InvalidCredentialsError();
    }

    await this.registerSuccess(user, input.ipAddress);

    // Família nova: cada login inicia uma linhagem própria, de modo que revogar
    // uma sessão comprometida não derruba as outras do mesmo usuário.
    const session = await this.deps.sessionIssuer.issue(user.id);
    await this.deps.refreshTokens.save(session.entity);

    this.deps.logger.info('auth.login.succeeded', {
      userId: user.id,
      familyId: session.entity.familyId,
      ipAddress: input.ipAddress,
    });

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn,
      userId: user.id,
    };
  }

  private parseEmail(raw: string): Email | null {
    try {
      return Email.create(raw);
    } catch (error) {
      if (error instanceof ValidationError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Consome o mesmo tempo de uma verificação real, sem ter o que verificar.
   *
   * O resultado é descartado por construção: o hash inerte não tem senha
   * correspondente.
   */
  private async burnTime(password: string): Promise<void> {
    await this.deps.passwordHasher.verify(password, this.deps.inertPasswordHash);
  }

  private async registerFailure(
    user: User,
    now: Date,
    ipAddress: string | undefined,
  ): Promise<void> {
    // O incremento é feito pelo repositório, em uma operação atômica, e não por
    // uma leitura seguida de escrita aqui. Contar do lado do caso de uso
    // permitiria que tentativas simultâneas lessem o mesmo total e gravassem por
    // cima umas das outras — cem em paralelo contariam como uma, e o bloqueio
    // deixaria de valer contra ataque automatizado.
    const updated = await this.deps.users.registerFailedLogin(user, now, this.deps.lockoutPolicy);

    this.deps.logger.info('auth.login.failed', {
      reason: 'wrong_password',
      userId: user.id,
      failedAttempts: updated.failedLoginAttempts,
      locked: updated.isLocked(now),
      ipAddress,
    });
  }

  private async registerSuccess(user: User, ipAddress: string | undefined): Promise<void> {
    const updated = user.recordSuccessfulLogin();

    // Nada mudou quando não havia falhas acumuladas, que é o caso comum. Evita
    // uma escrita no banco a cada login.
    if (updated === user) {
      return;
    }

    try {
      await this.deps.users.save(updated);
    } catch (error) {
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }

      // A senha estava correta: a autenticação vale. Zerar o contador é
      // escrituração, e o próximo login bem-sucedido faz de novo. Recusar aqui
      // puniria quem acertou a credencial por causa de uma corrida no banco.
      this.deps.logger.warn('auth.login.reset_conflict', {
        userId: user.id,
        ipAddress,
      });
    }
  }
}

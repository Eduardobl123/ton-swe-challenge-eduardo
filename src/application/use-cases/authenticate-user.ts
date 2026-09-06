import { ConcurrencyError, InvalidCredentialsError, ValidationError } from '../../domain/errors';
import { Email, type LockoutPolicy, type PasswordHash } from '../../domain/value-objects';
import type { User } from '../../domain/entities';
import type {
  Clock,
  Logger,
  PasswordHasher,
  TokenSigner,
  UserRepository,
} from '../../domain/ports';
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
  readonly tokenSigner: TokenSigner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly lockoutPolicy: LockoutPolicy;
  readonly accessTokenTtlSeconds: number;
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

    if (user.isLocked(now)) {
      // A senha não é verificada — não faz sentido gastar argon2 por uma conta
      // bloqueada — mas o tempo é equalizado para que a resposta continue
      // indistinguível de uma senha errada.
      await this.burnTime(input.password);
      this.deps.logger.warn('auth.login.locked', {
        userId: user.id,
        lockedUntil: user.lockedUntil?.toISOString(),
        ipAddress: input.ipAddress,
      });
      throw new InvalidCredentialsError();
    }

    const matches = await this.deps.passwordHasher.verify(input.password, user.passwordHash);

    if (!matches) {
      await this.registerFailure(user, now, input.ipAddress);
      throw new InvalidCredentialsError();
    }

    await this.registerSuccess(user, input.ipAddress);

    const accessToken = await this.deps.tokenSigner.sign(
      { subject: user.id },
      this.deps.accessTokenTtlSeconds,
    );

    this.deps.logger.info('auth.login.succeeded', {
      userId: user.id,
      ipAddress: input.ipAddress,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.deps.accessTokenTtlSeconds,
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
    const updated = user.recordFailedLogin(now, this.deps.lockoutPolicy);

    try {
      await this.deps.users.save(updated);
    } catch (error) {
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }

      // Perder a corrida significa que outra tentativa gravou primeiro, e o
      // contador dela já conta esta janela de ataque. Repetir a escrita seria
      // pior: transformaria tentativas simultâneas em trabalho extra no banco
      // exatamente quando alguém está tentando adivinhar a senha. A resposta ao
      // cliente é a mesma de qualquer outra falha.
      this.deps.logger.warn('auth.login.concurrent_update', {
        userId: user.id,
        ipAddress,
      });
      return;
    }

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

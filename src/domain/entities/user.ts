import { ValidationError } from '../errors';
import type { Email, LockoutPolicy, PasswordHash } from '../value-objects';

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: PasswordHash;
  readonly failedLoginAttempts: number;
  /** Instante em que o bloqueio expira. Ausente quando a conta não está bloqueada. */
  readonly lockedUntil: Date | undefined;
  readonly createdAt: Date;
  /** Versão lida da persistência, usada no controle de concorrência otimista. */
  readonly version: number;
}

/**
 * Usuário autenticável.
 *
 * A entidade é imutável: cada transição devolve uma instância nova em vez de
 * alterar a atual. Isso remove uma categoria inteira de bug — o objeto que o
 * caso de uso leu não muda embaixo dele — e torna cada transição uma função
 * pura, testável sem cenário.
 *
 * ## Estado do bloqueio
 *
 * O bloqueio é derivado de `lockedUntil` comparado ao relógio, e não guardado
 * como um campo `status` separado. Manter os dois seria estado redundante capaz
 * de discordar de si mesmo: uma conta marcada como bloqueada cujo `lockedUntil`
 * já passou, ou o contrário. Com uma única fonte de verdade, a pergunta "esta
 * conta está bloqueada?" tem exatamente uma resposta possível.
 *
 * ## Concorrência
 *
 * `version` acompanha a instância porque duas tentativas de login simultâneas
 * podem ler o mesmo contador e gravar por cima uma da outra, zerando o efeito do
 * bloqueio. O repositório usa esse número como condição de escrita e falha com
 * `ConcurrencyError` quando perde a corrida (issue #7).
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  public static create(props: UserProps): User {
    if (props.id.trim().length === 0) {
      throw new ValidationError('id', 'Identificador do usuário é obrigatório.');
    }

    if (!Number.isInteger(props.failedLoginAttempts) || props.failedLoginAttempts < 0) {
      throw new ValidationError(
        'failedLoginAttempts',
        'Contador de tentativas deve ser inteiro não negativo.',
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new ValidationError('version', 'Versão deve ser inteiro não negativo.');
    }

    return new User(props);
  }

  public get id(): string {
    return this.props.id;
  }

  public get email(): Email {
    return this.props.email;
  }

  public get passwordHash(): PasswordHash {
    return this.props.passwordHash;
  }

  public get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }

  public get lockedUntil(): Date | undefined {
    return this.props.lockedUntil;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get version(): number {
    return this.props.version;
  }

  /** Verdadeiro enquanto o bloqueio ainda não expirou. */
  public isLocked(now: Date): boolean {
    return this.props.lockedUntil !== undefined && this.props.lockedUntil.getTime() > now.getTime();
  }

  /**
   * Registra uma tentativa malsucedida, aplicando o bloqueio quando a política
   * mandar.
   *
   * O contador **não** é zerado quando um bloqueio expira, apenas quando um
   * login dá certo. Sem isso, quem ataca esperaria o bloqueio passar e voltaria
   * ao mesmo ritmo indefinidamente, sem nunca escalar a punição.
   */
  public recordFailedLogin(now: Date, policy: LockoutPolicy): User {
    const failedLoginAttempts = this.props.failedLoginAttempts + 1;
    const lockDurationMs = policy.lockDurationMs(failedLoginAttempts);

    return new User({
      ...this.props,
      failedLoginAttempts,
      lockedUntil: lockDurationMs > 0 ? new Date(now.getTime() + lockDurationMs) : undefined,
    });
  }

  /** Zera contador e bloqueio após uma autenticação bem-sucedida. */
  public recordSuccessfulLogin(): User {
    if (this.props.failedLoginAttempts === 0 && this.props.lockedUntil === undefined) {
      return this;
    }

    return new User({
      ...this.props,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });
  }

  /**
   * Cópia dos dados para o adaptador de persistência.
   *
   * Devolver a estrutura interna evita que o mapeador do DynamoDB dependa de uma
   * dúzia de acessos individuais e quebre em silêncio quando um campo novo
   * aparecer.
   */
  public toProps(): UserProps {
    return { ...this.props };
  }
}

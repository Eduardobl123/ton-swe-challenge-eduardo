import { ValidationError } from '../errors';
import { cloneDate, cloneOptionalDate } from '../shared/clone-date';
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

    return new User({
      ...props,
      createdAt: cloneDate(props.createdAt),
      lockedUntil: cloneOptionalDate(props.lockedUntil),
    });
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
    return cloneOptionalDate(this.props.lockedUntil);
  }

  public get createdAt(): Date {
    return cloneDate(this.props.createdAt);
  }

  public get version(): number {
    return this.props.version;
  }

  /**
   * Instante em que o bloqueio expira, ou `undefined` quando não há bloqueio em
   * vigor.
   *
   * Existe além de `isLocked` porque quem precisa reagir ao bloqueio quase
   * sempre precisa também da data — e obtê-la em duas chamadas obrigaria a
   * tratar um caso impossível, o de estar bloqueado sem instante de expiração.
   */
  public lockedUntilIfLocked(now: Date): Date | undefined {
    const { lockedUntil } = this.props;

    if (lockedUntil === undefined || lockedUntil.getTime() <= now.getTime()) {
      return undefined;
    }

    return cloneDate(lockedUntil);
  }

  /** Verdadeiro enquanto o bloqueio ainda não expirou. */
  public isLocked(now: Date): boolean {
    return this.lockedUntilIfLocked(now) !== undefined;
  }

  /**
   * Registra uma tentativa malsucedida, aplicando o bloqueio quando a política
   * mandar.
   *
   * O contador **não** é zerado quando um bloqueio expira, apenas quando um
   * login dá certo. Sem isso, quem ataca esperaria o bloqueio passar e voltaria
   * ao mesmo ritmo indefinidamente, sem nunca escalar a punição.
   *
   * Quando a política em vigor não pede bloqueio, o bloqueio anterior é
   * mantido, e não apagado. Uma tentativa malsucedida jamais deve reduzir a
   * proteção da conta: afrouxar `LOCKOUT_MAX_ATTEMPTS` em produção destrancaria
   * contas já bloqueadas na próxima senha errada.
   *
   * Pela mesma razão, o instante de expiração só avança — ver `extendLock`.
   */
  public recordFailedLogin(now: Date, policy: LockoutPolicy): User {
    const failedLoginAttempts = this.props.failedLoginAttempts + 1;
    const lockDurationMs = policy.lockDurationMs(failedLoginAttempts);

    return new User({
      ...this.props,
      failedLoginAttempts,
      lockedUntil: this.extendLock(now, lockDurationMs),
    });
  }

  /**
   * Estende o bloqueio, nunca o encurta.
   *
   * Duas tentativas simultâneas que cruzam o limiar calculam durações
   * diferentes — a que conta 5 falhas pede 30s, a que conta 6 pede 60s — e nada
   * ordena as gravações que se seguem. Tomar sempre o instante mais distante faz
   * o resultado independer da ordem de chegada; sem isso, a tentativa que
   * calculou o bloqueio menor pode gravar por último e encurtar uma punição já
   * aplicada, que é exatamente o que quem ataca em paralelo procura (issue #24).
   *
   * O adaptador DynamoDB impõe a mesma regra por `ConditionExpression`, porque
   * lá as duas escritas são de fato concorrentes; aqui a garantia é do domínio,
   * e é o que mantém `InMemoryUserRepository` fiel ao comportamento real.
   */
  private extendLock(now: Date, lockDurationMs: number): Date | undefined {
    const { lockedUntil } = this.props;

    if (lockDurationMs === 0) {
      return lockedUntil;
    }

    const candidate = new Date(now.getTime() + lockDurationMs);

    return lockedUntil !== undefined && lockedUntil.getTime() >= candidate.getTime()
      ? lockedUntil
      : candidate;
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
    return {
      ...this.props,
      createdAt: cloneDate(this.props.createdAt),
      lockedUntil: cloneOptionalDate(this.props.lockedUntil),
    };
  }
}

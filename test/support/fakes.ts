import type {
  Clock,
  IdGenerator,
  LogFields,
  Logger,
  OpaqueToken,
  PasswordHasher,
  SecureTokenGenerator,
  TokenSigner,
} from '../../src/domain/ports';
import type { AccessTokenClaims, AccessTokenInput } from '../../src/domain/ports';
import { PasswordHash } from '../../src/domain/value-objects';

/** Relógio controlado, para exercitar expiração sem esperar. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current.getTime());
  }

  public advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Hasher determinístico que registra cada verificação.
 *
 * O registro é o que permite provar a defesa contra enumeração por tempo: o
 * teste verifica que o hasher foi chamado **também** quando o e-mail não existe.
 * Sem essa contagem, a equalização seria uma promessa no comentário.
 */
export class FakePasswordHasher implements PasswordHasher {
  public readonly verifications: { password: string; hash: string }[] = [];

  public hash(plainPassword: string): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.create(`hashed:${plainPassword}`));
  }

  public verify(plainPassword: string, passwordHash: PasswordHash): Promise<boolean> {
    this.verifications.push({ password: plainPassword, hash: passwordHash.value });

    return Promise.resolve(passwordHash.value === `hashed:${plainPassword}`);
  }
}

/** Gera tokens previsíveis, para que o teste possa afirmar sobre eles. */
export class FakeSecureTokenGenerator implements SecureTokenGenerator {
  private contador = 0;

  public generate(): OpaqueToken {
    this.contador += 1;
    const value = `refresh-${String(this.contador)}`;

    return { value, hash: this.hash(value) };
  }

  public hash(value: string): string {
    return `sha256:${value}`;
  }
}

/** Identificadores sequenciais e ordenáveis, como exige a porta. */
export class SequentialIdGenerator implements IdGenerator {
  private contador = 0;

  public next(): string {
    this.contador += 1;

    return `id-${String(this.contador).padStart(4, '0')}`;
  }
}

export class FakeTokenSigner implements TokenSigner {
  public readonly signed: { subject: string; ttlSeconds: number }[] = [];

  public sign(input: AccessTokenInput, ttlSeconds: number): Promise<string> {
    this.signed.push({ subject: input.subject, ttlSeconds });

    return Promise.resolve(`token-for:${input.subject}`);
  }

  public verify(token: string): Promise<AccessTokenClaims> {
    const subject = token.replace('token-for:', '');

    return Promise.resolve({
      sub: subject,
      jti: 'jti',
      iat: 0,
      exp: 900,
      iss: 'test',
      aud: 'test',
    });
  }
}

export interface RecordedLog {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly fields: LogFields;
}

/** Logger que guarda tudo, para afirmar sobre o que foi e o que não foi emitido. */
export class RecordingLogger implements Logger {
  public readonly records: RecordedLog[] = [];

  public info(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'info', event, fields });
  }

  public warn(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'warn', event, fields });
  }

  public error(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'error', event, fields });
  }

  public events(): string[] {
    return this.records.map((record) => record.event);
  }

  public find(event: string): RecordedLog | undefined {
    return this.records.find((record) => record.event === event);
  }

  /** Tudo que foi logado, serializado — base para provar que nada sensível vazou. */
  public dump(): string {
    return JSON.stringify(this.records);
  }
}

import { createHash, randomBytes } from 'node:crypto';
import type { OpaqueToken, SecureTokenGenerator } from '../../domain/ports';

/**
 * 256 bits de entropia.
 *
 * É o mesmo tamanho da saída do hash: menos que isso enfraqueceria o segredo
 * sem economizar nada, e mais não acrescentaria força, já que o espaço de busca
 * passa a ser limitado pelo próprio hash.
 */
const TOKEN_BYTES = 32;

export class Sha256TokenGenerator implements SecureTokenGenerator {
  public generate(): OpaqueToken {
    // `randomBytes` usa a fonte criptográfica do sistema. `Math.random` seria
    // previsível o bastante para permitir adivinhar um token válido.
    const value = randomBytes(TOKEN_BYTES).toString('base64url');

    return { value, hash: this.hash(value) };
  }

  public hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}

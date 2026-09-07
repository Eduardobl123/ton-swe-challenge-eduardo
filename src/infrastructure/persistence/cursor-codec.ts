import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { InvalidCursorError } from '../../domain/errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Codificação do cursor de paginação.
 *
 * O cursor carrega uma posição na ordenação da tabela. Entregá-lo em texto
 * legível tem dois problemas, e assinar resolve só um deles.
 *
 * **Forja.** Sem autenticação, qualquer pessoa monta um cursor apontando para
 * onde quiser. Hoje isso alcança apenas posições que a navegação normal também
 * alcança, mas passa a importar quando o cursor carregar a chave de continuação
 * do DynamoDB (issue #7).
 *
 * **Vazamento.** Base64 não esconde nada: decodificar é uma linha. Na issue #7 o
 * conteúdo passa a ser `pk`, `sk` e as chaves do índice, ou seja, o desenho
 * interno da tabela publicado em toda resposta paginada.
 *
 * Por isso a escolha é cifra autenticada em vez de apenas HMAC: o AES-GCM
 * entrega confidencialidade e integridade na mesma operação. Um cursor
 * adulterado falha na verificação da etiqueta e é recusado; um cursor legítimo
 * não revela o que carrega.
 *
 * ## De onde vem a chave
 *
 * Derivada do segredo do JWT com um rótulo próprio. Duas razões: a chave
 * precisa ser **estável entre instâncias**, senão um cursor emitido por uma
 * invocação do Lambda seria ilegível para a seguinte, e uma variável de
 * ambiente a menos é um parâmetro a menos para provisionar (issue #10).
 *
 * A separação por rótulo garante que a chave derivada não sirva para assinar
 * token, nem o segredo do token para ler cursor. Rotacionar o segredo invalida
 * os cursores em circulação, o que é aceitável: eles são efêmeros, e a rotação
 * já invalida todos os tokens de qualquer forma.
 */
export class CursorCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`page-cursor:${secret}`, 'utf8').digest();
  }

  /**
   * O vetor de inicialização é aleatório a cada chamada, então a mesma posição
   * produz cursores diferentes. Além de exigido pelo modo GCM, isso impede que
   * alguém correlacione duas respostas pelo cursor.
   */
  public encode(payload: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  /**
   * @throws {InvalidCursorError} para cursor adulterado, truncado, emitido com
   *   outro segredo ou que simplesmente não é um cursor. Todos recebem a mesma
   *   recusa: distinguir os casos ajudaria quem estivesse tentando forjar um.
   */
  public decode(cursor: string): string {
    try {
      const raw = Buffer.from(cursor, 'base64url');

      if (raw.length <= IV_LENGTH + TAG_LENGTH) {
        throw new InvalidCursorError();
      }

      const decipher = createDecipheriv(ALGORITHM, this.key, raw.subarray(0, IV_LENGTH));
      decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

      const plaintext = Buffer.concat([
        decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch {
      throw new InvalidCursorError();
    }
  }
}

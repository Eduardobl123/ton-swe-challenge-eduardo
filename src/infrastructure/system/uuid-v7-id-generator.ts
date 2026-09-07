import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '../../domain/ports';

/**
 * Identificadores UUID versão 7.
 *
 * Os 48 bits mais significativos são o instante de criação em milissegundos, o
 * que torna o identificador **ordenável por tempo** quando comparado como texto.
 * É o que permite usá-lo direto na chave de classificação do DynamoDB
 * (ADR 0003), sem manter um campo de data só para ordenar, e o que faz dois
 * registros criados no mesmo milissegundo desempatarem de forma estável.
 *
 * A versão 4, que é o padrão de `randomUUID`, é aleatória pura: identificadores
 * criados em sequência ficam espalhados, e ordenar por eles não diz nada sobre
 * quando foram criados.
 */
export class UuidV7IdGenerator implements IdGenerator {
  public next(): string {
    const bytes = randomBytes(16);
    const timestamp = Date.now();

    // 48 bits de tempo, do byte mais significativo para o menos.
    bytes.writeUIntBE(timestamp, 0, 6);

    // Versão 7 nos quatro bits altos do sétimo byte.
    bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);

    // Variante RFC 4122 nos dois bits altos do nono byte.
    bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

    const hex = bytes.toString('hex');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }
}

/**
 * Gerador de identificadores.
 *
 * A implementação deve produzir valores **ordenáveis por tempo de criação**
 * (ULID ou UUID versão 7). Como o DynamoDB ordena pela chave de classificação
 * (ADR 0003), um identificador aleatório puro obrigaria a manter um campo de
 * data só para ordenar, e desempataria mal quando dois registros nascessem no
 * mesmo milissegundo.
 */
export interface IdGenerator {
  next(): string;
}

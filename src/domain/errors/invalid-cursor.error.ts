import { DomainError } from './app-error';

/**
 * O cursor de paginação não pôde ser interpretado.
 *
 * Cobre desde erro honesto de cópia até tentativa de forjar um cursor. Os dois
 * casos recebem a mesma resposta: o conteúdo do cursor é detalhe interno da
 * persistência (ADR 0004) e explicar por que ele é inválido entregaria o formato
 * das chaves da tabela.
 */
export class InvalidCursorError extends DomainError {
  constructor(message = 'Cursor de paginação inválido ou expirado.') {
    super('INVALID_CURSOR', message);
  }
}

import { DomainError } from './app-error';

/**
 * Um valor não satisfaz as invariantes do domínio.
 *
 * Levantado pelos objetos de valor na construção — e-mail malformado, preço
 * negativo, nome vazio. É a rede de segurança do domínio, não a validação de
 * entrada da API: esta acontece antes, no schema da rota (issue #8), com
 * mensagem voltada ao consumidor. Se um erro destes chega ao cliente, ou o
 * schema da rota está incompleto, ou o dado veio corrompido da persistência.
 */
export class ValidationError extends DomainError {
  constructor(
    /** Campo que falhou, no formato que o domínio conhece (ex.: `email`). */
    public readonly field: string,
    message: string,
  ) {
    super('VALIDATION_ERROR', message, { field });
  }
}

import type { ErrorCode } from './error-code';

/**
 * Base de todo erro esperado da aplicação.
 *
 * "Esperado" é a distinção que importa: uma senha errada e um limite de
 * requisições estourado são resultados previstos, não defeitos. Eles carregam
 * código estável, são traduzidos para uma resposta HTTP específica e **não**
 * geram evento no Sentry (issue #9). Qualquer coisa que não estenda esta classe
 * é falha não prevista e vira 500 com alerta.
 *
 * Alguns destes erros nunca chegam ao cliente como si mesmos. Conta bloqueada e
 * reuso de refresh token são convertidos na borda para a resposta genérica
 * equivalente, porque a diferença entre eles é informação útil para um atacante.
 * A coluna "exposto ao cliente" de `docs/errors.md` registra quais são.
 */
export abstract class AppError extends Error {
  /** Código estável usado pelo cliente e pelo tradutor HTTP. */
  public readonly code: ErrorCode;

  /** Contexto para log e depuração. Nunca é serializado na resposta. */
  public readonly details: Readonly<Record<string, unknown>>;

  protected constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });

    // Remove o próprio construtor do stack trace, deixando o topo da pilha na
    // linha que de fato levantou o erro.
    Error.captureStackTrace(this, new.target);
  }
}

/**
 * Erro que nasce de uma regra de negócio, e não de infraestrutura.
 *
 * Serve como marcador: permite que o tratamento na borda distinga "a regra disse
 * não" de "o banco não respondeu", que são coisas diferentes para quem opera.
 */
export abstract class DomainError extends AppError {}

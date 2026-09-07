export interface ErrorContext {
  /** Correlação com o log e com a resposta devolvida ao cliente. */
  readonly requestId: string;
  readonly route: string;
  /** Identificador do usuário, jamais o e-mail. */
  readonly userId?: string | undefined;
}

/**
 * Encaminhamento de falhas imprevistas para quem opera.
 *
 * A porta existe para que o tratamento de erro não conheça o Sentry. Trocar de
 * ferramenta, ou desligá-la em um ambiente, vira substituir um adaptador.
 *
 * **Só falha imprevista passa por aqui.** Credencial inválida, limite excedido
 * e token expirado são resultados previstos: enviá-los encheria o alerta de
 * eventos cotidianos até ninguém mais olhar para ele — o mesmo raciocínio que
 * separou reuso de token de sessão encerrada.
 */
export interface ErrorReporter {
  /** Nunca lança: falha ao reportar não pode derrubar a requisição. */
  capture(error: unknown, context: ErrorContext): void;
}

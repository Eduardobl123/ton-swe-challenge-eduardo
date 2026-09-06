/**
 * Campos aceitos em um evento de log.
 *
 * A restrição a valores primitivos é a razão de ser deste tipo. Ela impede, em
 * tempo de compilação, que uma entidade inteira ou um `PasswordHash` seja
 * passado para o log — o vazamento acidental deixa de depender da atenção de
 * quem escreve a chamada e passa a ser recusado pelo compilador.
 *
 * Para registrar um usuário, passe `userId`, nunca o objeto.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * Emissão de eventos estruturados.
 *
 * O primeiro argumento é o **nome do evento**, não uma frase: `auth.login.failed`
 * em vez de "falha ao autenticar usuário". Nome estável é agregável e alertável;
 * frase livre só é pesquisável por substring e muda quando alguém reescreve a
 * mensagem.
 *
 * A porta vive no domínio para que os casos de uso emitam eventos sem conhecer
 * o pino, o Sentry ou o formato do CloudWatch (issue #9).
 */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

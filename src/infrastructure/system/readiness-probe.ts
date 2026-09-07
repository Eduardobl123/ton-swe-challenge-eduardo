/**
 * Verificação de que as dependências externas respondem.
 *
 * Separada da checagem de vida por um motivo operacional: reiniciar um serviço
 * cuja dependência caiu não resolve nada, e é isso que acontece quando as duas
 * sondas são a mesma. O efeito de não estar pronto é sair do balanceamento; o
 * de não estar vivo é ser morto e recriado.
 */
export interface ReadinessProbe {
  /** Nunca lança: uma dependência fora do ar é resposta, não exceção. */
  check(): Promise<boolean>;
}

/**
 * Sonda para os adaptadores em memória, que não têm dependência externa.
 *
 * A verificação real, um `DescribeTable` no DynamoDB, entra na issue #7 e exige
 * a permissão correspondente no IAM (issue #10) — foi justamente o que a
 * revisão do plano identificou como faltando.
 */
export class AlwaysReadyProbe implements ReadinessProbe {
  public check(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

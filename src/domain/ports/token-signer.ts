/** Dados que o emissor recebe para montar o token. */
export interface AccessTokenInput {
  /** Identificador do usuário. Vira a claim `sub`. */
  readonly subject: string;
}

/** Conteúdo verificado de um access token. */
export interface AccessTokenClaims {
  readonly sub: string;
  /** Identificador único do token, base para revogação caso venha a existir. */
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
}

/**
 * Emissão e verificação do access token.
 *
 * A porta é agnóstica ao algoritmo. Hoje o adaptador assina em HS256; migrar
 * para chave assimétrica com JWKS, quando houver mais de um verificador, não
 * altera esta interface nem os casos de uso (ADR 0006).
 *
 * `verify` deve rejeitar token expirado, com emissor ou público divergentes e —
 * criticamente — com algoritmo diferente do esperado. Aceitar o algoritmo
 * declarado no cabeçalho do próprio token é a falha clássica que permite forjar
 * uma assinatura.
 */
export interface TokenSigner {
  sign(input: AccessTokenInput, ttlSeconds: number): Promise<string>;

  /** @throws quando o token é inválido, expirado ou foi adulterado. */
  verify(token: string): Promise<AccessTokenClaims>;
}

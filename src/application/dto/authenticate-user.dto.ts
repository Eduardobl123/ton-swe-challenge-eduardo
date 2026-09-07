export interface AuthenticateUserInput {
  readonly email: string;
  readonly password: string;
  /** Origem da requisição. Só entra no log, para investigar abuso. */
  readonly ipAddress: string | undefined;
}

export interface AuthenticateUserOutput {
  readonly accessToken: string;
  /**
   * Credencial de renovação, de uso único.
   *
   * Só o hash é persistido; este é o único momento em que o valor existe fora
   * do cliente.
   */
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  /** Validade do access token, em segundos. */
  readonly expiresIn: number;
  readonly userId: string;
}

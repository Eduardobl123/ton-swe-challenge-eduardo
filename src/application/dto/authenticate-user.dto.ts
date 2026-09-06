export interface AuthenticateUserInput {
  readonly email: string;
  readonly password: string;
  /** Origem da requisição. Só entra no log, para investigar abuso. */
  readonly ipAddress: string | undefined;
}

export interface AuthenticateUserOutput {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  /** Validade do access token, em segundos. */
  readonly expiresIn: number;
  readonly userId: string;
}

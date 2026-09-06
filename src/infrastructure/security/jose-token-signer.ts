import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AccessTokenClaims, AccessTokenInput, Clock, TokenSigner } from '../../domain/ports';

/**
 * Algoritmo fixo, nunca lido do token.
 *
 * A falha clássica de JWT é aceitar o algoritmo declarado no cabeçalho do
 * próprio token: quem forja envia `alg: none` ou troca por um algoritmo com
 * chave conhecida e a assinatura passa. Passar a lista explícita para o
 * verificador fecha isso.
 */
const ALGORITHM = 'HS256';

export interface JoseTokenSignerOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  /**
   * Fonte de tempo usada para calcular `iat` e `exp`.
   *
   * Ler o relógio da parede aqui tornaria a validade do token intestável sem
   * esperar de verdade — os testes ponta a ponta (issue #13) precisam expirar
   * um token avançando o relógio, não forjando um.
   */
  readonly clock: Clock;
}

/**
 * Emissão e verificação de access token com `jose`.
 *
 * A troca por chave assimétrica com JWKS, quando houver mais de um verificador,
 * fica contida nesta classe: a porta `TokenSigner` e os casos de uso não mudam
 * (ADR 0006).
 */
export class JoseTokenSigner implements TokenSigner {
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clock: Clock;

  constructor({ secret, issuer, audience, clock }: JoseTokenSignerOptions) {
    this.secret = new TextEncoder().encode(secret);
    this.issuer = issuer;
    this.audience = audience;
    this.clock = clock;
  }

  public async sign({ subject }: AccessTokenInput, ttlSeconds: number): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);

    return (
      new SignJWT()
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(subject)
        .setIssuer(this.issuer)
        .setAudience(this.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        // Identifica esta emissão. Hoje serve a log e correlação; é também o que
        // uma eventual lista de revogação usaria como chave.
        .setJti(randomUUID())
        .sign(this.secret)
    );
  }

  /**
   * @throws quando a assinatura, o emissor, o público, o algoritmo ou a
   *   validade não conferem, ou quando falta uma claim obrigatória. Quem chama
   *   trata qualquer falha como "não autenticado", sem distinguir o motivo.
   */
  public async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [ALGORITHM],
      // A validade também é conferida contra o relógio injetado. Sem isto,
      // emitir pelo relógio de teste e verificar pelo da parede daria resultados
      // incoerentes, e a expiração continuaria intestável.
      currentDate: this.clock.now(),
    });

    const { sub, jti, iat, exp } = payload;

    // Um token pode ter assinatura, emissor e público válidos e ainda assim não
    // servir: basta ter sido emitido por outro serviço que compartilha o
    // segredo, ou por uma versão anterior deste emissor. Conferir aqui é o que
    // permite tipar o retorno sem asserção — o compilador passa a saber o que
    // foi verificado, em vez de acreditar.
    if (sub === undefined || jti === undefined || iat === undefined || exp === undefined) {
      throw new Error('Access token sem as claims obrigatórias.');
    }

    return {
      sub,
      jti,
      iat,
      exp,
      // `iss` e `aud` já foram conferidos contra os valores esperados pelo
      // próprio jwtVerify, então devolvemos os configurados. Além de dispensar
      // asserção, evita expor o formato de lista que a especificação permite
      // em `aud`.
      iss: this.issuer,
      aud: this.audience,
    };
  }
}

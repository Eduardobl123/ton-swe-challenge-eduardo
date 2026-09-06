import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { JoseTokenSigner } from '../../../../src/infrastructure/security';

const SECRET = 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
const OPTIONS = { secret: SECRET, issuer: 'ton-swe-challenge', audience: 'ton-swe-challenge-api' };

const signer = new JoseTokenSigner(OPTIONS);
const key = new TextEncoder().encode(SECRET);

describe('JoseTokenSigner', () => {
  describe('emissão', () => {
    it('emite um token que ele próprio verifica', async () => {
      const token = await signer.sign({ subject: 'user-1' }, 900);

      await expect(signer.verify(token)).resolves.toMatchObject({
        sub: 'user-1',
        iss: OPTIONS.issuer,
        aud: OPTIONS.audience,
      });
    });

    it('inclui um identificador único por emissão', async () => {
      const [a, b] = await Promise.all([
        signer.sign({ subject: 'user-1' }, 900).then((t) => signer.verify(t)),
        signer.sign({ subject: 'user-1' }, 900).then((t) => signer.verify(t)),
      ]);

      expect(a.jti).not.toBe(b.jti);
    });

    it('respeita a validade informada', async () => {
      const claims = await signer.verify(await signer.sign({ subject: 'user-1' }, 900));

      expect(claims.exp - claims.iat).toBe(900);
    });
  });

  describe('recusa', () => {
    it('rejeita token assinado com outro segredo', async () => {
      const outro = new JoseTokenSigner({ ...OPTIONS, secret: 'b'.repeat(48) });

      await expect(signer.verify(await outro.sign({ subject: 'user-1' }, 900))).rejects.toThrow();
    });

    it('rejeita token de outro emissor', async () => {
      const outro = new JoseTokenSigner({ ...OPTIONS, issuer: 'outro-servico' });

      await expect(signer.verify(await outro.sign({ subject: 'user-1' }, 900))).rejects.toThrow();
    });

    it('rejeita token destinado a outro público', async () => {
      const outro = new JoseTokenSigner({ ...OPTIONS, audience: 'outra-api' });

      await expect(signer.verify(await outro.sign({ subject: 'user-1' }, 900))).rejects.toThrow();
    });

    it('rejeita token expirado', async () => {
      const expirado = await new SignJWT()
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer(OPTIONS.issuer)
        .setAudience(OPTIONS.audience)
        .setIssuedAt(1000)
        .setExpirationTime(1001)
        .setJti('jti')
        .sign(key);

      await expect(signer.verify(expirado)).rejects.toThrow();
    });

    it('rejeita token sem assinatura, com alg none', async () => {
      // A falha clássica de JWT. O verificador recebe a lista de algoritmos
      // aceitos, então o cabeçalho do token não decide nada.
      const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      const corpo = Buffer.from(
        JSON.stringify({
          sub: 'user-1',
          iss: OPTIONS.issuer,
          aud: OPTIONS.audience,
          exp: Math.floor(Date.now() / 1000) + 900,
          iat: Math.floor(Date.now() / 1000),
          jti: 'forjado',
        }),
      ).toString('base64url');

      await expect(signer.verify(`${cabecalho}.${corpo}.`)).rejects.toThrow();
    });

    it('rejeita token com assinatura válida mas sem as claims obrigatórias', async () => {
      // Cenário real: outro serviço que compartilha o segredo, ou uma versão
      // anterior deste emissor.
      const semJti = await new SignJWT()
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer(OPTIONS.issuer)
        .setAudience(OPTIONS.audience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(key);

      await expect(signer.verify(semJti)).rejects.toThrow(/claims obrigatórias/);
    });

    it('rejeita texto que não é um token', async () => {
      await expect(signer.verify('nao-e-um-jwt')).rejects.toThrow();
    });
  });
});

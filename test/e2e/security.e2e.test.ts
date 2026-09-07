import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { SENHA, semearProdutos, subirAmbiente, type Ambiente } from './support/journey';

const EMAIL = 'seguranca@ton.com.br';
const SEGREDO = 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
const EMISSOR = 'ton-swe-challenge';
const PUBLICO = 'ton-swe-challenge-api';

interface Problema {
  code: string;
  status: number;
  title: string;
  type: string;
  instance: string;
  requestId: string;
}

let env: Ambiente;
let userId: string;

const codificar = (segredo: string) => new TextEncoder().encode(segredo);

/** Emite um token com as claims certas e o que o teste quiser alterar. */
async function forjar(
  opcoes: { segredo?: string; emissor?: string; publico?: string; expiraEm?: number } = {},
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);

  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(opcoes.emissor ?? EMISSOR)
    .setAudience(opcoes.publico ?? PUBLICO)
    .setIssuedAt(agora - 60)
    .setExpirationTime(agora + (opcoes.expiraEm ?? 900))
    .sign(codificar(opcoes.segredo ?? SEGREDO));
}

/**
 * As recusas que a borda precisa fazer, exercitadas contra o sistema montado.
 *
 * Cada caso aqui é uma forma conhecida de burlar autenticação por JWT. Testá-los
 * em unidade prova que o verificador recusa; testá-los daqui prova que o
 * verificador é de fato quem decide, que nenhum plugin registrado antes dele
 * deixa passar, e que a recusa sai no formato que o contrato promete.
 */
describe('segurança da borda', () => {
  beforeAll(async () => {
    env = await subirAmbiente('security');
    userId = await env.criarUsuario(EMAIL);
    await semearProdutos(env.container, 3);
  }, 60_000);

  afterAll(async () => {
    await env.encerrar();
  });

  const listar = (headers: Record<string, string>) =>
    env.chamar('GET', '/v1/products', { headers });

  it('recusa token com alg none, a falha clássica de JWT', async () => {
    // Cabeçalho e payload legíveis, assinatura vazia: aceito por qualquer
    // verificador que confie no `alg` declarado pelo próprio token.
    const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const corpo = Buffer.from(
      JSON.stringify({
        sub: userId,
        iss: EMISSOR,
        aud: PUBLICO,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');

    const resposta = await listar({ authorization: `Bearer ${cabecalho}.${corpo}.` });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json<Problema>().code).toBe('TOKEN_INVALID');
  });

  it('recusa token assinado com outro segredo', async () => {
    const token = await forjar({ segredo: 'outro-segredo-igualmente-longo-com-32-caracteres' });
    const resposta = await listar({ authorization: `Bearer ${token}` });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json<Problema>().code).toBe('TOKEN_INVALID');
  });

  it('recusa token vencido, e diz que venceu', async () => {
    const token = await forjar({ expiraEm: -60 });
    const resposta = await listar({ authorization: `Bearer ${token}` });

    expect(resposta.statusCode).toBe(401);
    // Distinguir vencido de inválido é útil e não vaza nada: o cliente já tem o
    // token, e a diferença decide entre renovar e autenticar de novo.
    expect(resposta.json<Problema>().code).toBe('TOKEN_EXPIRED');
  });

  it('recusa token de outro emissor sem chamá-lo de vencido', async () => {
    const token = await forjar({ emissor: 'outro-emissor' });
    const resposta = await listar({ authorization: `Bearer ${token}` });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json<Problema>().code).toBe('TOKEN_INVALID');
  });

  it('recusa token emitido para outro público', async () => {
    const token = await forjar({ publico: 'outra-api' });
    const resposta = await listar({ authorization: `Bearer ${token}` });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json<Problema>().code).toBe('TOKEN_INVALID');
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['sem esquema', 'apenas-o-token'],
    ['esquema errado', 'Basic dXN1YXJpbzpzZW5oYQ=='],
    ['Bearer sem valor', 'Bearer'],
    ['Bearer com espaço só', 'Bearer '],
    ['esquema em caixa diferente sem token', 'bearer'],
  ])('recusa cabeçalho de autorização %s', async (_caso, valor) => {
    const resposta = await listar(valor === undefined ? {} : { authorization: valor });

    expect(resposta.statusCode).toBe(401);
    expect(['UNAUTHENTICATED', 'TOKEN_INVALID']).toContain(resposta.json<Problema>().code);
  });

  it('o e-mail em caixa diferente ainda autentica', async () => {
    // Endereço de e-mail não distingue caixa na parte local para efeito prático,
    // e tratar `Fulano@` como conta diferente de `fulano@` criaria duas contas
    // para a mesma pessoa — e um bloqueio que não bloqueia.
    const resposta = await env.chamar('POST', '/v1/auth/login', {
      payload: { email: EMAIL.toUpperCase(), password: SENHA },
    });

    expect(resposta.statusCode).toBe(200);
  });

  it('recusa senha absurdamente longa sem tentar processá-la', async () => {
    const resposta = await env.chamar('POST', '/v1/auth/login', {
      payload: { email: EMAIL, password: 'a'.repeat(5_000) },
    });

    // Verificar hash de argon2 custa CPU de propósito. Aceitar entrada de
    // qualquer tamanho antes de recusar transformaria o login em amplificador.
    expect([400, 401]).toContain(resposta.statusCode);
  });

  it('recusa corpo acima do teto sem derrubar o processo', async () => {
    const resposta = await env.chamar('POST', '/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      payload: { email: EMAIL, password: 'x'.repeat(70 * 1024) },
    });

    expect(resposta.statusCode).toBe(413);
    expect(resposta.json<Problema>().code).toBe('VALIDATION_ERROR');
  });

  it('recusa mídia não suportada', async () => {
    const resposta = await env.chamar('POST', '/v1/auth/login', {
      headers: { 'content-type': 'application/xml' },
      payload: '<login/>',
    });

    expect(resposta.statusCode).toBe(415);
    expect(resposta.json<Problema>().code).toBe('VALIDATION_ERROR');
  });

  it('recusa JSON malformado como problema do cliente', async () => {
    const resposta = await env.chamar('POST', '/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      payload: '{"email": "sem fechar"',
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json<Problema>().code).toBe('VALIDATION_ERROR');
  });

  it('não devolve detalhe interno em nenhuma recusa', async () => {
    const token = await forjar({ segredo: 'outro-segredo-igualmente-longo-com-32-caracteres' });
    const resposta = await listar({ authorization: `Bearer ${token}` });
    const corpo = resposta.body.toLowerCase();

    for (const vazamento of ['jose', 'jwsinvalid', 'signature', 'stack', 'at object', '.ts:']) {
      expect(corpo).not.toContain(vazamento);
    }
  });

  it('o cursor de paginação não aceita valor forjado', async () => {
    const login = await env.chamar('POST', '/v1/auth/login', {
      payload: { email: EMAIL, password: SENHA },
    });
    const { accessToken } = login.json<{ accessToken: string }>();

    // O cursor é cifrado com AES-GCM. Um valor inventado não autentica, e a
    // resposta precisa ser recusa limpa — não erro interno, que revelaria que o
    // servidor tentou decifrá-lo.
    const resposta = await env.chamar('GET', '/v1/products?cursor=Zm9yamFkbw', {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json<Problema>().code).toBe('INVALID_CURSOR');
  });
});

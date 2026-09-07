import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Email } from '../../src/domain/value-objects';
import { SENHA, subirAmbiente, type Ambiente } from './support/journey';

const TENTATIVAS_ATE_BLOQUEAR = 5;
const SENHA_ERRADA = 'senha-que-nao-e-a-certa';

let env: Ambiente;

/** Remove o que muda a cada requisição, para comparar o resto byte a byte. */
const semIdentificadores = (corpo: string): string =>
  corpo.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');

const entrar = (email: string, password: string) =>
  env.chamar('POST', '/v1/auth/login', { payload: { email, password } });

const contarFalhas = async (email: string): Promise<number> => {
  const usuario = await env.container.seeding.users.findByEmail(Email.create(email));

  if (usuario === null || usuario === undefined) {
    throw new Error(`Usuário ${email} não existe.`);
  }

  return usuario.toProps().failedLoginAttempts;
};

const estaBloqueado = async (email: string): Promise<boolean> => {
  const usuario = await env.container.seeding.users.findByEmail(Email.create(email));

  return usuario?.isLocked(env.container.seeding.clock.now()) ?? false;
};

/**
 * O bloqueio por tentativas, do lado de fora.
 *
 * A cota de login fica alta nesta suíte de propósito: o que está sob prova é o
 * bloqueio por conta, e deixar a cota por origem interferir tornaria o teste
 * verde por um motivo diferente do que ele afirma.
 */
describe('bloqueio de conta', () => {
  beforeAll(async () => {
    env = await subirAmbiente('lockout', { RATE_LIMIT_LOGIN_PER_MINUTE: '200' });
  }, 60_000);

  afterAll(async () => {
    await env.encerrar();
  });

  it('após as tentativas, a senha certa recebe resposta idêntica à errada', async () => {
    const email = 'bloqueio@ton.com.br';
    await env.criarUsuario(email);

    let ultimaFalha = '';

    for (let i = 1; i <= TENTATIVAS_ATE_BLOQUEAR; i += 1) {
      const resposta = await entrar(email, SENHA_ERRADA);

      expect(resposta.statusCode).toBe(401);
      ultimaFalha = resposta.body;
    }

    expect(await estaBloqueado(email)).toBe(true);

    const comSenhaCerta = await entrar(email, SENHA);

    expect(comSenhaCerta.statusCode).toBe(401);
    // O ponto inteiro do desenho: quem tem a senha certa e quem não tem recebem
    // a mesma coisa. Um `ACCOUNT_LOCKED` distinto confirmaria a existência da
    // conta e ainda diria que a senha estava certa — enumeração servida pronta.
    expect(semIdentificadores(comSenhaCerta.body)).toBe(semIdentificadores(ultimaFalha));
    expect(comSenhaCerta.json<{ code: string }>().code).toBe('INVALID_CREDENTIALS');

    // Indistinguível para quem chama, explícito para quem opera.
    expect(env.logger.events()).toContain('auth.login.locked');
  }, 120_000);

  it('passado o bloqueio, a senha certa volta a valer', async () => {
    const email = 'destravado@ton.com.br';
    await env.criarUsuario(email);

    for (let i = 1; i <= TENTATIVAS_ATE_BLOQUEAR; i += 1) {
      expect((await entrar(email, SENHA_ERRADA)).statusCode).toBe(401);
    }

    expect(await estaBloqueado(email)).toBe(true);

    await env.expirarBloqueio(email);

    const depois = await entrar(email, SENHA);

    expect(depois.statusCode).toBe(200);
    // Entrar zera o contador: sem isso, a conta voltaria a bloquear na primeira
    // digitação errada meses depois, e o bloqueio viraria permanente na prática.
    expect(await contarFalhas(email)).toBe(0);
  }, 120_000);

  it('vinte tentativas simultâneas não perdem contagem nem deixam a conta aberta', async () => {
    const email = 'corrida@ton.com.br';
    await env.criarUsuario(email);

    const respostas = await Promise.all(
      Array.from({ length: 20 }, () => entrar(email, SENHA_ERRADA)),
    );

    // Nenhuma requisição pode vazar a falha de concorrência: quem está do outro
    // lado tentou uma senha errada, e é isso que precisa ouvir.
    for (const resposta of respostas) {
      expect(resposta.statusCode).toBe(401);
      expect(resposta.json<{ code: string }>().code).toBe('INVALID_CREDENTIALS');
    }

    // A regressão que este teste existe para impedir: com incremento lido e
    // escrito de volta, vinte tentativas paralelas terminavam com o contador em
    // 1 e a conta destravada — o bloqueio existia e não bloqueava.
    expect(await contarFalhas(email)).toBeGreaterThanOrEqual(TENTATIVAS_ATE_BLOQUEAR);
    expect(await estaBloqueado(email)).toBe(true);
  }, 120_000);
});

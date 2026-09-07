import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, semearProdutos, subirAmbiente, type Ambiente } from './support/journey';

const LIMITE = 60;
const USUARIO_A = 'cota-a@ton.com.br';
const USUARIO_B = 'cota-b@ton.com.br';

let env: Ambiente;

async function autenticar(email: string): Promise<string> {
  const resposta = await env.chamar('POST', '/v1/auth/login', {
    payload: { email, password: SENHA },
  });

  expect(resposta.statusCode).toBe(200);

  return resposta.json<{ accessToken: string }>().accessToken;
}

/**
 * A cota, exercitada até estourar, contra o contador de verdade.
 *
 * O contador vive no DynamoDB porque a função não guarda estado entre
 * invocações (ADR 0005). Em unidade o contador é um duplo e responde na hora;
 * aqui ele é o mesmo item de tabela sendo incrementado por requisições
 * sucessivas, que é a única forma de provar que a soma atravessa a fronteira do
 * processo — e que a chave separa um usuário do outro.
 */
describe('cota por usuário', () => {
  beforeAll(async () => {
    env = await subirAmbiente('ratelimit');
    await env.criarUsuario(USUARIO_A);
    await env.criarUsuario(USUARIO_B);
    await semearProdutos(env.container, 3);
  }, 60_000);

  afterAll(async () => {
    await env.encerrar();
  });

  it('libera até o limite, recusa a seguinte e não afeta outro usuário', async () => {
    const tokenA = await autenticar(USUARIO_A);
    const cabecalhos = { authorization: `Bearer ${tokenA}` };

    let anterior = LIMITE;

    for (let i = 1; i <= LIMITE; i += 1) {
      const resposta = await env.chamar('GET', '/v1/products', { headers: cabecalhos });

      expect(resposta.statusCode, `requisição ${String(i)} deveria passar`).toBe(200);
      expect(Number(resposta.headers['ratelimit-limit'])).toBe(LIMITE);

      const restante = Number(resposta.headers['ratelimit-remaining']);

      if (i === 1) {
        // A primeira requisição da janela não sofre ponderação: aqui o número é
        // exato, e é o que prova que a cota realmente conta.
        expect(restante).toBe(LIMITE - 1);
      }

      // O saldo nunca sobe e nunca fica abaixo do que o consumo bruto permitiria.
      // A igualdade exata não serve: a janela desliza sobre duas janelas fixas,
      // e uma virada no meio do laço faz o peso da anterior decair, deixando a
      // estimativa legitimamente **abaixo** da contagem acumulada. Exigir o valor
      // cravado transformaria o horário de execução em causa de falha.
      expect(restante).toBeLessThanOrEqual(anterior);
      expect(restante).toBeGreaterThanOrEqual(LIMITE - i);
      anterior = restante;
    }

    const excedida = await env.chamar('GET', '/v1/products', { headers: cabecalhos });

    expect(excedida.statusCode).toBe(429);
    expect(excedida.json<{ code: string }>().code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(excedida.headers['ratelimit-remaining'])).toBe(0);

    // Sem `Retry-After` o cliente só tem a opção de tentar de novo às cegas, e
    // tentativa cega é o que transforma limite em tempestade.
    const esperar = Number(excedida.headers['retry-after']);
    expect(Number.isInteger(esperar)).toBe(true);
    expect(esperar).toBeGreaterThan(0);
    // A janela desliza sobre duas janelas fixas ponderadas, e o valor depende de
    // quanto da janela corrente já passou quando a cota estoura — varia de
    // poucos segundos a pouco mais de uma janela. O que precisa valer sempre é o
    // teto: um contador que não decaísse devolveria espera crescente e deixaria
    // preso para sempre justamente o cliente que obedece ao cabeçalho.
    expect(esperar).toBeLessThanOrEqual(120);

    // A chave é o usuário. Se fosse a origem, o segundo usuário — que compartilha
    // o mesmo IP nesta suíte — já entraria bloqueado.
    const tokenB = await autenticar(USUARIO_B);
    const outro = await env.chamar('GET', '/v1/products', {
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(outro.statusCode).toBe(200);
    expect(Number(outro.headers['ratelimit-remaining'])).toBe(LIMITE - 1);
  }, 180_000);
});

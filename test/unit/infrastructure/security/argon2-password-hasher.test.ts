import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher, INERT_PASSWORD_HASH } from '../../../../src/infrastructure/security';
import { PasswordHash } from '../../../../src/domain/value-objects';

const hasher = new Argon2PasswordHasher();
const SENHA = 'Desafio@Ton2026';

describe('Argon2PasswordHasher', () => {
  it('deriva um hash verificável', async () => {
    const hash = await hasher.hash(SENHA);

    await expect(hasher.verify(SENHA, hash)).resolves.toBe(true);
  });

  it('recusa a senha errada', async () => {
    const hash = await hasher.hash(SENHA);

    await expect(hasher.verify('outra-senha', hash)).resolves.toBe(false);
  });

  it('usa argon2id com os parâmetros do OWASP', async () => {
    // Fixados explicitamente, e não herdados do padrão da biblioteca: parâmetro
    // de segurança não deve mudar quando uma dependência sobe de versão.
    const hash = await hasher.hash(SENHA);
    const [, algoritmo, versao, parametros] = hash.value.split('$');

    expect(algoritmo).toBe('argon2id');
    expect(versao).toBe('v=19');
    expect(parametros).toBe('m=19456,t=2,p=1');
  });

  it('gera hashes diferentes para a mesma senha', async () => {
    // Sal aleatório: dois usuários com a mesma senha não compartilham hash, o
    // que impede identificá-los em um vazamento.
    const [a, b] = await Promise.all([hasher.hash(SENHA), hasher.hash(SENHA)]);

    expect(a.value).not.toBe(b.value);
  });

  it('devolve falso em vez de estourar com hash corrompido', async () => {
    // Um registro ilegível não deve virar 500: a resposta diferente seria mais
    // um sinal sobre o estado da conta.
    const corrompido = PasswordHash.create('isto-nao-e-um-hash-argon2');

    await expect(hasher.verify(SENHA, corrompido)).resolves.toBe(false);
  });

  it('nenhuma senha corresponde ao hash inerte', async () => {
    // É o que garante que verificar contra ele nunca autentique ninguém.
    await expect(hasher.verify(SENHA, INERT_PASSWORD_HASH)).resolves.toBe(false);
    await expect(hasher.verify('', INERT_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('o hash inerte usa os mesmos parâmetros do hash real', async () => {
    // Se divergissem, verificar contra ele custaria um tempo diferente e a
    // comparação revelaria quais e-mails existem.
    const real = await hasher.hash(SENHA);

    expect(INERT_PASSWORD_HASH.value.split('$').slice(1, 4)).toEqual(
      real.value.split('$').slice(1, 4),
    );
  });
});

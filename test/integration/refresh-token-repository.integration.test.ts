import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DynamoDbRefreshTokenRepository } from '../../src/infrastructure/persistence/dynamodb';
import { RefreshToken } from '../../src/domain/entities';
import { ConcurrencyError } from '../../src/domain/errors';
import { createTestTable, type TestTable } from './support';

const EMISSAO = new Date('2026-09-06T12:00:00.000Z');
const EXPIRACAO = new Date(EMISSAO.getTime() + 7 * 24 * 60 * 60 * 1_000);

let table: TestTable;
let repo: DynamoDbRefreshTokenRepository;
let sufixo = 0;

const token = (familyId: string, overrides: { hash?: string } = {}): RefreshToken => {
  sufixo += 1;

  return RefreshToken.create({
    id: `rt-${String(sufixo)}`,
    userId: 'user-1',
    tokenHash: overrides.hash ?? `hash-${String(sufixo)}`,
    familyId,
    issuedAt: new Date(EMISSAO.getTime() + sufixo * 1_000),
    expiresAt: EXPIRACAO,
    revokedAt: undefined,
    replacedByTokenId: undefined,
  });
};

describe('DynamoDbRefreshTokenRepository', () => {
  beforeAll(async () => {
    table = await createTestTable('refresh');
    repo = new DynamoDbRefreshTokenRepository(table.clients.documents, table.tableName);
  });

  afterAll(async () => {
    await table.drop();
  });

  let familia: string;

  beforeEach(() => {
    familia = `fam-${String(sufixo)}-${String(Date.now())}`;
  });

  it('grava e encontra pelo hash', async () => {
    const atual = token(familia);
    await repo.save(atual);

    const achado = await repo.findByHash(atual.tokenHash);

    expect(achado?.id).toBe(atual.id);
    expect(achado?.familyId).toBe(familia);
  });

  it('devolve nulo para hash desconhecido', async () => {
    await expect(repo.findByHash('nunca-gravado')).resolves.toBeNull();
  });

  describe('rotação', () => {
    it('marca o antecessor e grava o sucessor', async () => {
      const atual = token(familia);
      await repo.save(atual);
      const proximo = token(familia);

      await repo.rotate(atual, proximo);

      const antigo = await repo.findByHash(atual.tokenHash);
      const novo = await repo.findByHash(proximo.tokenHash);
      expect(antigo?.isRotated()).toBe(true);
      expect(antigo?.replacedByTokenId).toBe(proximo.id);
      expect(novo?.isUsable(EMISSAO)).toBe(true);
    });

    it('recusa rotacionar um token já rotacionado', async () => {
      const atual = token(familia);
      await repo.save(atual);
      await repo.rotate(atual, token(familia));

      await expect(repo.rotate(atual, token(familia))).rejects.toBeInstanceOf(ConcurrencyError);
    });

    it('recusa rotacionar um token revogado', async () => {
      const atual = token(familia);
      await repo.save(atual);
      await repo.revokeFamily(familia, EMISSAO);

      await expect(repo.rotate(atual, token(familia))).rejects.toBeInstanceOf(ConcurrencyError);
    });

    it('em rotações simultâneas, exatamente uma vence', async () => {
      // É o que sustenta a detecção de reuso. Se as duas passassem, a cópia
      // roubada seria tão válida quanto a legítima.
      const atual = token(familia);
      await repo.save(atual);

      const resultados = await Promise.allSettled([
        repo.rotate(atual, token(familia)),
        repo.rotate(atual, token(familia)),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('a rotação é tudo ou nada', async () => {
      // Um sucessor gravado sem o antecessor marcado deixaria o token antigo
      // funcionando, que é exatamente o estado que a detecção precisa evitar.
      const atual = token(familia);
      await repo.save(atual);
      await repo.rotate(atual, token(familia));
      const terceiro = token(familia);

      await repo.rotate(atual, terceiro).catch(() => undefined);

      await expect(repo.findByHash(terceiro.tokenHash)).resolves.toBeNull();
    });
  });

  describe('revogação por família', () => {
    it('derruba todos os tokens da linhagem', async () => {
      const primeiro = token(familia);
      await repo.save(primeiro);
      const segundo = token(familia);
      await repo.rotate(primeiro, segundo);

      await repo.revokeFamily(familia, EMISSAO);

      expect((await repo.findByHash(primeiro.tokenHash))?.isRevoked()).toBe(true);
      expect((await repo.findByHash(segundo.tokenHash))?.isRevoked()).toBe(true);
    });

    it('não toca em outra família', async () => {
      const alheio = token(`${familia}-outra`);
      await repo.save(alheio);
      const meu = token(familia);
      await repo.save(meu);

      await repo.revokeFamily(familia, EMISSAO);

      expect((await repo.findByHash(alheio.tokenHash))?.isRevoked()).toBe(false);
    });

    it('preserva o instante da primeira revogação', async () => {
      // Saber quando a sessão caiu é o que permite reconstruir a linha do tempo
      // de um incidente.
      const atual = token(familia);
      await repo.save(atual);
      await repo.revokeFamily(familia, EMISSAO);

      await repo.revokeFamily(familia, new Date(EMISSAO.getTime() + 60_000));

      expect((await repo.findByHash(atual.tokenHash))?.revokedAt).toEqual(EMISSAO);
    });

    it('é inofensiva em família inexistente', async () => {
      await expect(repo.revokeFamily('nao-existe', EMISSAO)).resolves.toBeUndefined();
    });
  });
});

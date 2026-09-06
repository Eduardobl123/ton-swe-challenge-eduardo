import { describe, expect, it } from 'vitest';
import { RefreshToken, type RefreshTokenProps } from '../../../../src/domain/entities';
import { ValidationError } from '../../../../src/domain/errors';

const EMISSAO = new Date('2026-09-06T12:00:00.000Z');
const DIA = 24 * 60 * 60 * 1_000;
const EXPIRACAO = new Date(EMISSAO.getTime() + 7 * DIA);

const criarToken = (overrides: Partial<RefreshTokenProps> = {}): RefreshToken =>
  RefreshToken.create({
    id: 'rt-1',
    userId: 'user-1',
    tokenHash: 'a'.repeat(64),
    familyId: 'fam-1',
    issuedAt: EMISSAO,
    expiresAt: EXPIRACAO,
    revokedAt: undefined,
    replacedByTokenId: undefined,
    ...overrides,
  });

describe('RefreshToken', () => {
  describe('invariantes', () => {
    it.each([
      ['id vazio', { id: '  ' }],
      ['usuário vazio', { userId: '' }],
      ['hash vazio', { tokenHash: '   ' }],
      ['família vazia', { familyId: '' }],
    ])('recusa %s', (_caso, overrides) => {
      expect(() => criarToken(overrides)).toThrow(ValidationError);
    });

    it('recusa expiração anterior à emissão', () => {
      expect(() => criarToken({ expiresAt: new Date(EMISSAO.getTime() - 1) })).toThrow(
        ValidationError,
      );
    });

    it('recusa expiração igual à emissão', () => {
      expect(() => criarToken({ expiresAt: EMISSAO })).toThrow(ValidationError);
    });
  });

  describe('expiração', () => {
    it('não está expirado antes do prazo', () => {
      expect(criarToken().isExpired(new Date(EXPIRACAO.getTime() - 1))).toBe(false);
    });

    it('está expirado no instante exato do prazo', () => {
      // A decisão é do domínio, não do TTL do DynamoDB, que remove itens com
      // atraso de até 48 horas.
      expect(criarToken().isExpired(EXPIRACAO)).toBe(true);
    });

    it('está expirado depois do prazo', () => {
      expect(criarToken().isExpired(new Date(EXPIRACAO.getTime() + 1))).toBe(true);
    });
  });

  describe('estado de uso', () => {
    it('token recém-emitido é utilizável', () => {
      const token = criarToken();

      expect(token.id).toBe('rt-1');
      expect(token.isUsable(EMISSAO)).toBe(true);
      expect(token.wasAlreadyUsed()).toBe(false);
      expect(token.isRevoked()).toBe(false);
      expect(token.isRotated()).toBe(false);
    });

    it('token expirado não é utilizável', () => {
      expect(criarToken().isUsable(EXPIRACAO)).toBe(false);
    });

    it('token rotacionado não é utilizável e conta como já usado', () => {
      const rotacionado = criarToken().rotateTo('rt-2');

      expect(rotacionado.isUsable(EMISSAO)).toBe(false);
      expect(rotacionado.wasAlreadyUsed()).toBe(true);
      expect(rotacionado.replacedByTokenId).toBe('rt-2');
    });

    it('token revogado não é utilizável e conta como já usado', () => {
      const revogado = criarToken().revoke(EMISSAO);

      expect(revogado.isUsable(EMISSAO)).toBe(false);
      expect(revogado.wasAlreadyUsed()).toBe(true);
      expect(revogado.revokedAt).toEqual(EMISSAO);
    });

    it('token expirado sozinho não caracteriza reuso', () => {
      // Expirar é o curso normal; reuso é apresentar algo já consumido.
      const token = criarToken();

      expect(token.isExpired(EXPIRACAO)).toBe(true);
      expect(token.wasAlreadyUsed()).toBe(false);
    });
  });

  describe('transições', () => {
    it('rotação não altera a instância original', () => {
      const original = criarToken();
      original.rotateTo('rt-2');

      expect(original.isRotated()).toBe(false);
    });

    it('revogação de token já revogado devolve a mesma instância', () => {
      const revogado = criarToken().revoke(EMISSAO);

      expect(revogado.revoke(new Date(EMISSAO.getTime() + 1000))).toBe(revogado);
    });

    it('preserva a família ao rotacionar, para permitir revogar tudo de uma vez', () => {
      expect(criarToken().rotateTo('rt-2').familyId).toBe('fam-1');
    });

    it('mantém o hash e o usuário após as transições', () => {
      const token = criarToken().rotateTo('rt-2').revoke(EMISSAO);

      expect(token.tokenHash).toBe('a'.repeat(64));
      expect(token.userId).toBe('user-1');
      expect(token.issuedAt).toEqual(EMISSAO);
      expect(token.expiresAt).toEqual(EXPIRACAO);
    });
  });

  it('devolve uma cópia em toProps', () => {
    const token = criarToken();
    const props = token.toProps();
    (props as { tokenHash: string }).tokenHash = 'alterado';
    props.expiresAt.setTime(0);

    expect(token.tokenHash).toBe('a'.repeat(64));
    expect(token.expiresAt).toEqual(EXPIRACAO);
  });

  it('não deixa antecipar a expiração pela data devolvida no getter', () => {
    // Recuar o expiresAt invalidaria um token que ainda deveria valer.
    const token = criarToken();

    token.expiresAt.setTime(0);
    token.issuedAt.setFullYear(1999);

    expect(token.isExpired(EMISSAO)).toBe(false);
    expect(token.issuedAt).toEqual(EMISSAO);
  });

  it('não deixa apagar a revogação pela data devolvida no getter', () => {
    const revogado = criarToken().revoke(EMISSAO);

    revogado.revokedAt?.setTime(0);

    expect(revogado.revokedAt).toEqual(EMISSAO);
    expect(revogado.isRevoked()).toBe(true);
  });
});

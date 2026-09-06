import { describe, expect, it } from 'vitest';
import { Email } from '../../../../src/domain/value-objects';
import { ValidationError } from '../../../../src/domain/errors';

describe('Email', () => {
  describe('normalização', () => {
    it('converte para minúsculas', () => {
      expect(Email.create('Maria@Ton.Com.BR').value).toBe('maria@ton.com.br');
    });

    it('remove espaços nas pontas', () => {
      expect(Email.create('  maria@ton.com.br  ').value).toBe('maria@ton.com.br');
    });

    it('trata variações de caixa como o mesmo endereço', () => {
      // Sem isto, `Maria@…` e `maria@…` virariam duas contas distintas e o login
      // passaria a depender de como a pessoa digitou.
      expect(Email.create('MARIA@TON.COM.BR').equals(Email.create('maria@ton.com.br'))).toBe(true);
    });
  });

  describe('aceitação', () => {
    it.each([
      'maria@ton.com.br',
      'maria.silva@ton.com.br',
      'maria+cobranca@ton.com.br',
      'maria_silva@sub.ton.com.br',
      "o'brien@ton.com.br",
      'maria-99@ton.io',
    ])('aceita %s', (raw) => {
      expect(() => Email.create(raw)).not.toThrow();
    });
  });

  describe('recusa', () => {
    it.each([
      ['vazio', ''],
      ['só espaços', '   '],
      ['sem arroba', 'mariaton.com.br'],
      ['sem domínio', 'maria@'],
      ['sem parte local', '@ton.com.br'],
      ['domínio sem ponto', 'maria@ton'],
      ['espaço no meio', 'maria silva@ton.com.br'],
      ['dois arrobas', 'maria@@ton.com.br'],
      ['domínio terminando em ponto', 'maria@ton.com.'],
    ])('recusa %s', (_caso, raw) => {
      expect(() => Email.create(raw)).toThrow(ValidationError);
    });

    it('recusa endereço acima de 254 caracteres', () => {
      const gigante = `${'a'.repeat(250)}@ton.com.br`;

      expect(() => Email.create(gigante)).toThrow(ValidationError);
    });

    it('recusa parte local acima de 64 caracteres', () => {
      expect(() => Email.create(`${'a'.repeat(65)}@ton.com.br`)).toThrow(ValidationError);
    });

    it('aponta o campo que falhou', () => {
      try {
        Email.create('inválido');
        expect.unreachable('deveria ter lançado');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).field).toBe('email');
        expect((error as ValidationError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('serialização', () => {
    it('serializa como o endereço normalizado', () => {
      const email = Email.create('Maria@Ton.com.br');

      expect(String(email)).toBe('maria@ton.com.br');
      expect(JSON.stringify({ email })).toBe('{"email":"maria@ton.com.br"}');
    });
  });

  it('distingue endereços diferentes', () => {
    expect(Email.create('a@ton.com.br').equals(Email.create('b@ton.com.br'))).toBe(false);
  });
});

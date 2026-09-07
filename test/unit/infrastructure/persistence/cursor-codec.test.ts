import { describe, expect, it } from 'vitest';
import { CursorCodec } from '../../../../src/infrastructure/persistence/cursor-codec';
import { InvalidCursorError } from '../../../../src/domain/errors';

const SEGREDO = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
const PAYLOAD = '2026-01-01T00:08:00.000Z#prod-008';

const codec = new CursorCodec(SEGREDO);

/** Inverte um byte do cursor, simulando adulteração em trânsito. */
const adulterar = (cursor: string, posicao: number): string => {
  const bytes = Buffer.from(cursor, 'base64url');
  const indice = posicao < 0 ? bytes.length + posicao : posicao;
  bytes.writeUInt8(bytes.readUInt8(indice) ^ 0xff, indice);

  return bytes.toString('base64url');
};

describe('CursorCodec', () => {
  it('recupera exatamente o que foi codificado', () => {
    expect(codec.decode(codec.encode(PAYLOAD))).toBe(PAYLOAD);
  });

  it('produz saída diferente a cada chamada para o mesmo conteúdo', () => {
    expect(codec.encode(PAYLOAD)).not.toBe(codec.encode(PAYLOAD));
  });

  it('não deixa o conteúdo legível', () => {
    const cursor = codec.encode(PAYLOAD);

    expect(cursor).not.toContain('prod-008');
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toContain('prod-008');
  });

  it('usa um alfabeto seguro para URL', () => {
    expect(codec.encode(PAYLOAD)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('preserva conteúdo com acento e caractere multibyte', () => {
    const acentuado = '2026-01-01T00:00:00.000Z#produção-café-😀';

    expect(codec.decode(codec.encode(acentuado))).toBe(acentuado);
  });

  describe('recusa', () => {
    it('cursor adulterado no final', () => {
      expect(() => codec.decode(adulterar(codec.encode(PAYLOAD), -1))).toThrow(InvalidCursorError);
    });

    it('cursor com vetor de inicialização alterado', () => {
      expect(() => codec.decode(adulterar(codec.encode(PAYLOAD), 0))).toThrow(InvalidCursorError);
    });

    it('cursor emitido com outro segredo', () => {
      const outro = new CursorCodec('um-segredo-completamente-diferente-do-outro');

      expect(() => codec.decode(outro.encode(PAYLOAD))).toThrow(InvalidCursorError);
    });

    it.each([
      ['texto qualquer', 'nao-e-um-cursor'],
      ['vazio', ''],
      ['curto demais para conter cabeçalho', Buffer.from('curto').toString('base64url')],
      ['conteúdo em claro', Buffer.from(PAYLOAD).toString('base64url')],
    ])('%s', (_caso, cursor) => {
      expect(() => codec.decode(cursor)).toThrow(InvalidCursorError);
    });

    it('não explica por que recusou', () => {
      // Distinguir "adulterado" de "não é um cursor" ajudaria quem tenta forjar.
      const outro = new CursorCodec('um-segredo-completamente-diferente-do-outro');
      const mensagens = ['nao-e-um-cursor', outro.encode(PAYLOAD)].map((c) => {
        try {
          codec.decode(c);
          return 'sem erro';
        } catch (error) {
          return (error as Error).message;
        }
      });

      expect(new Set(mensagens).size).toBe(1);
    });
  });

  it('a chave é separada por domínio: o mesmo segredo em outro papel não abre o cursor', () => {
    // A chave sai de sha256('page-cursor:' + segredo), então derivar o segredo
    // com outro rótulo não produz a mesma chave.
    const comOutroRotulo = new CursorCodec(`outro-papel:${SEGREDO}`);

    expect(() => codec.decode(comOutroRotulo.encode(PAYLOAD))).toThrow(InvalidCursorError);
  });
});

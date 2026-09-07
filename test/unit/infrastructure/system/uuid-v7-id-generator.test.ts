import { describe, expect, it } from 'vitest';
import { UuidV7IdGenerator } from '../../../../src/infrastructure/system/uuid-v7-id-generator';

const generator = new UuidV7IdGenerator();

describe('UuidV7IdGenerator', () => {
  it('gera identificadores únicos', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => generator.next()));

    expect(ids.size).toBe(1_000);
  });

  it('segue o formato canônico de UUID', () => {
    expect(generator.next()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('declara a versão 7 e a variante RFC 4122', () => {
    const id = generator.next();

    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('é ordenável por tempo de criação quando comparado como texto', async () => {
    // É a razão de usar a versão 7 em vez da 4. Sem isso, o identificador não
    // serviria na chave de classificação do DynamoDB e seria preciso manter um
    // campo de data só para ordenar.
    const antes = generator.next();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const depois = generator.next();

    expect(antes < depois).toBe(true);
  });

  it('carrega o instante de criação nos primeiros 48 bits', () => {
    const antes = Date.now();
    const id = generator.next();
    const depois = Date.now();

    const timestamp = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);

    expect(timestamp).toBeGreaterThanOrEqual(antes);
    expect(timestamp).toBeLessThanOrEqual(depois);
  });

  it('identificadores do mesmo milissegundo continuam distintos', () => {
    // Os bits restantes são aleatórios, o que desempata sem depender do relógio.
    const ids = new Set(Array.from({ length: 500 }, () => generator.next()));

    expect(ids.size).toBe(500);
  });
});

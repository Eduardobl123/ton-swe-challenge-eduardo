import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiterStore } from '../../../../src/infrastructure/persistence/in-memory/in-memory-rate-limiter-store';

const INICIO = new Date('2026-09-06T12:00:30.000Z');
const MINUTO = 60_000;

describe('InMemoryRateLimiterStore', () => {
  it('conta a primeira requisição da chave', async () => {
    const store = new InMemoryRateLimiterStore();

    const resultado = await store.hit('k', MINUTO, INICIO);

    expect(resultado.current).toBe(1);
    expect(resultado.previous).toBe(0);
  });

  it('alinha a janela ao tamanho dela, não ao instante da primeira requisição', async () => {
    // Alinhar ao relógio é o que faz instâncias diferentes concordarem sobre
    // onde uma janela começa.
    const store = new InMemoryRateLimiterStore();

    const resultado = await store.hit('k', MINUTO, INICIO);

    expect(resultado.windowStartedAt).toEqual(new Date('2026-09-06T12:00:00.000Z'));
  });

  it('acumula dentro da mesma janela', async () => {
    const store = new InMemoryRateLimiterStore();

    await store.hit('k', MINUTO, INICIO);
    const segundo = await store.hit('k', MINUTO, new Date(INICIO.getTime() + 1_000));

    expect(segundo.current).toBe(2);
  });

  it('preserva a contagem ao passar para a janela seguinte', async () => {
    const store = new InMemoryRateLimiterStore();
    await store.hit('k', MINUTO, INICIO);
    await store.hit('k', MINUTO, INICIO);

    const proxima = await store.hit('k', MINUTO, new Date(INICIO.getTime() + MINUTO));

    expect(proxima.current).toBe(1);
    expect(proxima.previous).toBe(2);
  });

  it('descarta a contagem depois de um intervalo sem tráfego', async () => {
    // Só a janela imediatamente anterior importa; arrastar uma antiga
    // penalizaria por requisições que já saíram do intervalo observado.
    const store = new InMemoryRateLimiterStore();
    await store.hit('k', MINUTO, INICIO);

    const depois = await store.hit('k', MINUTO, new Date(INICIO.getTime() + 5 * MINUTO));

    expect(depois.current).toBe(1);
    expect(depois.previous).toBe(0);
  });

  it('mantém chaves independentes', async () => {
    const store = new InMemoryRateLimiterStore();
    await store.hit('a', MINUTO, INICIO);
    await store.hit('a', MINUTO, INICIO);

    expect((await store.hit('b', MINUTO, INICIO)).current).toBe(1);
  });

  it('não perde contagem sob requisições simultâneas', async () => {
    // O mesmo erro que enfraquecia o bloqueio de conta: ler, somar e gravar
    // faria cem chamadas paralelas contarem como uma.
    const store = new InMemoryRateLimiterStore();

    await Promise.all(Array.from({ length: 100 }, () => store.hit('k', MINUTO, INICIO)));

    expect((await store.hit('k', MINUTO, INICIO)).current).toBe(101);
  });

  it('respeita janelas de tamanhos diferentes', async () => {
    const store = new InMemoryRateLimiterStore();

    const resultado = await store.hit('k', 10_000, INICIO);

    expect(resultado.windowStartedAt).toEqual(new Date('2026-09-06T12:00:30.000Z'));
  });
});

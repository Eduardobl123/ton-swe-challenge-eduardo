import { describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/infrastructure/system/system-clock';

describe('SystemClock', () => {
  it('devolve o instante atual', () => {
    const antes = Date.now();

    const agora = new SystemClock().now();

    expect(agora.getTime()).toBeGreaterThanOrEqual(antes);
    expect(agora.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('devolve uma instância nova a cada chamada', () => {
    // Devolver a mesma referência deixaria o chamador mexer no relógio.
    const clock = new SystemClock();

    expect(clock.now()).not.toBe(clock.now());
  });
});

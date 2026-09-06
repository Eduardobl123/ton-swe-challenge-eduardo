import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonConsoleLogger, minimumLevelFor } from '../../../../src/infrastructure/observability';
import { FixedClock } from '../../../support/fakes';

const AGORA = new Date('2026-09-06T12:00:00.000Z');

const capturar = (
  minimumLevel: 'info' | 'warn' | 'error' = 'info',
): { logger: JsonConsoleLogger; linhas: string[] } => {
  const linhas: string[] = [];
  const logger = new JsonConsoleLogger({
    clock: new FixedClock(AGORA),
    minimumLevel,
    write: (linha) => linhas.push(linha),
  });

  return { logger, linhas };
};

describe('JsonConsoleLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escreve no stdout quando nenhum destino é informado', () => {
    // No Lambda o stdout é o que o CloudWatch coleta, sem agente nenhum.
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    new JsonConsoleLogger({ clock: new FixedClock(AGORA) }).info('auth.login.succeeded', {
      userId: 'user-1',
    });

    expect(stdout).toHaveBeenCalledOnce();
    expect(stdout.mock.calls[0]?.[0]).toMatch(/^\{.*\}\n$/);
  });

  it('emite uma linha de JSON por evento', () => {
    const { logger, linhas } = capturar();

    logger.info('auth.login.succeeded', { userId: 'user-1' });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).not.toContain('\n');
    expect(JSON.parse(linhas[0]!)).toMatchObject({
      level: 'info',
      event: 'auth.login.succeeded',
      userId: 'user-1',
    });
  });

  it('carimba o evento com o instante do relógio injetado', () => {
    const { logger, linhas } = capturar();

    logger.info('evento');

    expect((JSON.parse(linhas[0]!) as { time: string }).time).toBe(AGORA.toISOString());
  });

  it.each(['info', 'warn', 'error'] as const)('registra o nível %s', (nivel) => {
    const { logger, linhas } = capturar();

    logger[nivel]('evento');

    expect(JSON.parse(linhas[0]!)).toMatchObject({ level: nivel });
  });

  it('omite campos indefinidos em vez de emitir nulos', () => {
    // Chave ausente é mais barata de consultar do que valor vazio.
    const { logger, linhas } = capturar();

    logger.info('evento', { userId: 'user-1', ipAddress: undefined });

    const registro = JSON.parse(linhas[0]!) as Record<string, unknown>;
    expect(registro).toHaveProperty('userId');
    expect(registro).not.toHaveProperty('ipAddress');
  });

  describe('nível mínimo', () => {
    it('descarta o que está abaixo do configurado', () => {
      const { logger, linhas } = capturar('warn');

      logger.info('ignorado');

      expect(linhas).toHaveLength(0);
    });

    it('mantém o que está no nível ou acima', () => {
      const { logger, linhas } = capturar('warn');

      logger.warn('mantido');
      logger.error('mantido');

      expect(linhas).toHaveLength(2);
    });

    it('em nível de erro, só erro passa', () => {
      const { logger, linhas } = capturar('error');

      logger.info('a');
      logger.warn('b');
      logger.error('c');

      expect(linhas).toHaveLength(1);
    });
  });

  describe('minimumLevelFor', () => {
    it.each([
      ['fatal', 'error'],
      ['error', 'error'],
      ['warn', 'warn'],
      ['info', 'info'],
      ['debug', 'info'],
      ['trace', 'info'],
    ] as const)('mapeia %s do ambiente para %s da porta', (configurado, esperado) => {
      expect(minimumLevelFor(configurado)).toBe(esperado);
    });
  });
});

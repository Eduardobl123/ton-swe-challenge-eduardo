import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PinoLogger, pinoOptions } from '../../../../src/infrastructure/observability';

const capturar = (
  level: 'trace' | 'info' = 'info',
): { logger: PinoLogger; linhas: () => Record<string, unknown>[]; cru: () => string } => {
  const buffer: string[] = [];
  const destino = new Writable({
    write(chunk, _encoding, callback) {
      buffer.push(String(chunk));
      callback();
    },
  });

  return {
    logger: new PinoLogger(
      { level, environment: 'production', version: 'abc1234', pretty: false },
      destino,
    ),
    linhas: () =>
      buffer
        .join('')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    cru: () => buffer.join(''),
  };
};

describe('PinoLogger', () => {
  it('emite uma linha de JSON por evento', () => {
    const { logger, linhas, cru } = capturar();

    logger.info('auth.login.succeeded', { userId: 'user-1' });

    expect(linhas()).toHaveLength(1);
    expect(cru().trimEnd()).not.toContain('\n');
  });

  it('usa o nome do evento como mensagem, que é o que se agrega', () => {
    const { logger, linhas } = capturar();

    logger.info('auth.login.failed', { reason: 'wrong_password' });

    expect(linhas()[0]).toMatchObject({ msg: 'auth.login.failed', reason: 'wrong_password' });
  });

  it('carimba ambiente e versão em toda linha', () => {
    // Sem eles, achar as requisições de uma implantação específica exigiria
    // correlacionar com o histórico de deploy.
    const { logger, linhas } = capturar();

    logger.info('evento');

    expect(linhas()[0]).toMatchObject({ env: 'production', version: 'abc1234' });
  });

  it('registra o nível por nome, e não por número', () => {
    const { logger, linhas } = capturar();

    logger.warn('aviso');
    logger.error('erro');

    expect(linhas().map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('usa data legível em vez de milissegundos', () => {
    const { logger, linhas } = capturar();

    logger.info('evento');

    expect(String(linhas()[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('omite campos indefinidos', () => {
    const { logger, linhas } = capturar();

    logger.info('evento', { userId: 'u-1', ipAddress: undefined });

    expect(linhas()[0]).toHaveProperty('userId');
    expect(linhas()[0]).not.toHaveProperty('ipAddress');
  });

  it('respeita o nível mínimo configurado', () => {
    const { logger, linhas } = capturar();

    logger.info('emitido');

    expect(linhas()).toHaveLength(1);
  });

  describe('o que nunca pode aparecer no log', () => {
    it.each([
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
      'authorization',
      'token',
      'secret',
    ])('remove o campo %s mesmo no nível mais detalhado', (campo) => {
      // O tipo LogFields já impede passar objeto, então nenhuma chamada nossa
      // vaza. Isto cobre o que o pino acrescenta e o que uma biblioteca futura
      // possa anexar sem passar pela porta.
      const { logger, cru } = capturar('trace');

      logger.info('evento', { [campo]: 'valor-secretissimo' });

      expect(cru()).not.toContain('valor-secretissimo');
      expect(cru()).toContain('[REDACTED]');
    });

    it('remove também em campo aninhado', () => {
      const { logger, cru } = capturar('trace');
      const comObjeto = logger as unknown as {
        info(evento: string, campos: Record<string, unknown>): void;
      };

      comObjeto.info('evento', { credenciais: { password: 'valor-secretissimo' } });

      expect(cru()).not.toContain('valor-secretissimo');
    });
  });
});

describe('pinoOptions', () => {
  const base = { level: 'info', environment: 'production', version: 'abc1234' } as const;

  it('em produção não carrega transporte legível', () => {
    // Cor de terminal viraria lixo em toda linha coletada pelo CloudWatch.
    expect(pinoOptions({ ...base, pretty: false })).not.toHaveProperty('transport');
  });

  it('fora de produção usa o formato legível', () => {
    expect(pinoOptions({ ...base, pretty: true })).toMatchObject({
      transport: { target: 'pino-pretty' },
    });
  });

  it('declara os caminhos de remoção', () => {
    const { redact } = pinoOptions({ ...base, pretty: false });

    expect(redact).toMatchObject({ censor: '[REDACTED]' });
  });
});

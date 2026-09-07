import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O cliente do SSM é substituído por inteiro.
 *
 * O que precisa ser provado é a decisão: quais parâmetros são pedidos, o que
 * acontece quando um não existe, e o que é escrito no ambiente. Subir um SSM de
 * mentira provaria o SDK, não este código.
 */
const send = vi.fn();

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    public send = (command: unknown): unknown => send(command);
  },
  GetParametersCommand: class {
    constructor(public readonly input: { Names: string[]; WithDecryption: boolean }) {}
  },
}));

const { resolveSecrets } = await import('../../../../src/infrastructure/config/secrets');

const entradaDoComando = (): { Names: string[]; WithDecryption: boolean } =>
  (send.mock.calls[0]?.[0] as { input: { Names: string[]; WithDecryption: boolean } }).input;

describe('resolveSecrets', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('não fala com o SSM quando nenhum parâmetro é apontado', async () => {
    // É o caso em desenvolvimento e nos testes: ali o valor vem direto do
    // ambiente.
    const env: NodeJS.ProcessEnv = { JWT_SECRET: 'valor-direto' };

    await resolveSecrets({ region: 'us-east-1', source: env });

    expect(send).not.toHaveBeenCalled();
    expect(env.JWT_SECRET).toBe('valor-direto');
  });

  it('busca e escreve o valor no destino esperado', async () => {
    send.mockResolvedValue({
      Parameters: [{ Name: '/app/jwt', Value: 'segredo-vindo-do-ssm' }],
    });
    const env: NodeJS.ProcessEnv = { JWT_SECRET_PARAMETER: '/app/jwt' };

    await resolveSecrets({ region: 'us-east-1', source: env });

    expect(env.JWT_SECRET).toBe('segredo-vindo-do-ssm');
  });

  it('pede os parâmetros em uma chamada só', async () => {
    // Cada ida ao SSM soma ao tempo de partida a frio.
    send.mockResolvedValue({
      Parameters: [
        { Name: '/app/jwt', Value: 'a' },
        { Name: '/app/sentry', Value: 'b' },
      ],
    });

    await resolveSecrets({
      region: 'us-east-1',
      source: { JWT_SECRET_PARAMETER: '/app/jwt', SENTRY_DSN_PARAMETER: '/app/sentry' },
    });

    expect(send).toHaveBeenCalledOnce();
    expect(entradaDoComando().Names).toEqual(['/app/jwt', '/app/sentry']);
  });

  it('pede o valor decifrado', async () => {
    send.mockResolvedValue({ Parameters: [{ Name: '/app/jwt', Value: 'a' }] });

    await resolveSecrets({ region: 'us-east-1', source: { JWT_SECRET_PARAMETER: '/app/jwt' } });

    expect(entradaDoComando().WithDecryption).toBe(true);
  });

  it('ignora apontador vazio, que é como o Sentry fica desligado', async () => {
    send.mockResolvedValue({ Parameters: [{ Name: '/app/jwt', Value: 'a' }] });

    await resolveSecrets({
      region: 'us-east-1',
      source: { JWT_SECRET_PARAMETER: '/app/jwt', SENTRY_DSN_PARAMETER: '' },
    });

    expect(entradaDoComando().Names).toEqual(['/app/jwt']);
  });

  it('falha quando um parâmetro apontado não existe', async () => {
    // Falhar aqui derruba a instância no carregamento, o que aparece no deploy.
    // Seguir sem o segredo produziria erro de autenticação inexplicável na
    // primeira requisição.
    send.mockResolvedValue({ Parameters: [], InvalidParameters: ['/app/jwt'] });

    await expect(
      resolveSecrets({ region: 'us-east-1', source: { JWT_SECRET_PARAMETER: '/app/jwt' } }),
    ).rejects.toThrow(/não encontrados no SSM/);
  });

  it('falha quando o parâmetro volta sem valor', async () => {
    send.mockResolvedValue({ Parameters: [{ Name: '/outro', Value: 'x' }] });

    await expect(
      resolveSecrets({ region: 'us-east-1', source: { JWT_SECRET_PARAMETER: '/app/jwt' } }),
    ).rejects.toThrow(/veio sem valor/);
  });

  it('falha quando a resposta não traz parâmetro nenhum', async () => {
    // Resposta vazia sem lista de inválidos é comportamento inesperado do
    // serviço; seguir sem o segredo seria pior que parar.
    send.mockResolvedValue({});

    await expect(
      resolveSecrets({ region: 'us-east-1', source: { JWT_SECRET_PARAMETER: '/app/jwt' } }),
    ).rejects.toThrow(/veio sem valor/);
  });

  it('descarta parâmetro devolvido sem nome', async () => {
    send.mockResolvedValue({
      Parameters: [{ Value: 'sem-nome' }, { Name: '/app/jwt', Value: 'certo' }],
    });
    const env: NodeJS.ProcessEnv = { JWT_SECRET_PARAMETER: '/app/jwt' };

    await resolveSecrets({ region: 'us-east-1', source: env });

    expect(env.JWT_SECRET).toBe('certo');
  });

  it('usa process.env quando nenhuma fonte é informada', async () => {
    await expect(resolveSecrets({ region: 'us-east-1' })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

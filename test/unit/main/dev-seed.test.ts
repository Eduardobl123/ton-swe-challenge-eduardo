import { describe, expect, it } from 'vitest';
import { buildContainer } from '../../../src/main/container';
import { loadConfig } from '../../../src/infrastructure/config/env';
import { seedForDevelopment } from '../../../src/main/dev-seed';
import { RecordingLogger } from '../../support/fakes';

const env = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
};

describe('seedForDevelopment', () => {
  it('recusa rodar em produção', async () => {
    // A senha é conhecida e está no .env.example. Criar essa conta em ambiente
    // real seria uma porta aberta com a chave publicada junto.
    const container = buildContainer(
      loadConfig({ ...env, NODE_ENV: 'production' }),
      new RecordingLogger(),
    );

    await expect(
      seedForDevelopment(container, { email: 'demo@ton.com.br', password: 'Desafio@Ton2026' }),
    ).rejects.toThrow(/produção/);
  });

  it('cria o usuário demo e o catálogo', async () => {
    const container = buildContainer(loadConfig(env), new RecordingLogger());

    await seedForDevelopment(container, {
      email: 'demo@ton.com.br',
      password: 'Desafio@Ton2026',
    });

    const pagina = await container.useCases.listProducts.execute({
      limit: 100,
      cursor: undefined,
    });
    expect(pagina.data).toHaveLength(42);

    const sessao = await container.useCases.authenticateUser.execute({
      email: 'demo@ton.com.br',
      password: 'Desafio@Ton2026',
      ipAddress: undefined,
    });
    expect(sessao.userId).toBeTruthy();
  });
});

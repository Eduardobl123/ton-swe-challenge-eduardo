import { describe, expect, it } from 'vitest';
import { buildContainer } from '../../../src/main/container';
import { loadConfig } from '../../../src/infrastructure/config/env';
import { seedForDevelopment } from '../../../src/main/dev-seed';
import { RecordingLogger } from '../../support/fakes';

const env = {
  JWT_SECRET: 'um-segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  TABLE_NAME: 'ton-challenge-test',
  // Sem Docker: a persistência real é exercitada pelos testes de integração.
  PERSISTENCE: 'memory',
};

describe('seedForDevelopment', () => {
  it('recusa rodar em produção', async () => {
    // A senha é conhecida e está no .env.example. Criar essa conta em ambiente
    // real seria uma porta aberta com a chave publicada junto.
    //
    // O container é montado com persistência real, que é a única aceita em
    // produção; criar os clientes não abre conexão nenhuma.
    const container = buildContainer(
      loadConfig({ ...env, NODE_ENV: 'production', PERSISTENCE: 'dynamodb' }),
      new RecordingLogger(),
    );

    await expect(
      seedForDevelopment(container, { email: 'demo@ton.com.br', password: 'Desafio@Ton2026' }),
    ).rejects.toThrow(/produção/);
  });

  it('a persistência em memória é recusada em produção', () => {
    // Sem isso, um ambiente mal configurado subiria guardando sessões e
    // contadores na memória de uma instância: eles sumiriam a cada reinício e
    // não seriam compartilhados entre invocações, sem erro visível.
    expect(() =>
      buildContainer(
        loadConfig({ ...env, NODE_ENV: 'production', PERSISTENCE: 'memory' }),
        new RecordingLogger(),
      ),
    ).toThrow(/memória não pode ser usada em produção/);
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

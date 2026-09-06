import { describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/in-memory/in-memory-user-repository';
import { User } from '../../../../src/domain/entities';
import { ConcurrencyError } from '../../../../src/domain/errors';
import { Email, PasswordHash } from '../../../../src/domain/value-objects';

const AGORA = new Date('2026-09-06T12:00:00.000Z');

const usuario = (overrides: Partial<ReturnType<User['toProps']>> = {}): User =>
  User.create({
    id: 'user-1',
    email: Email.create('maria@ton.com.br'),
    passwordHash: PasswordHash.create('hashed:x'),
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    createdAt: AGORA,
    version: 1,
    ...overrides,
  });

describe('InMemoryUserRepository', () => {
  it('encontra por e-mail, ignorando a caixa', async () => {
    const repo = new InMemoryUserRepository([usuario()]);

    await expect(repo.findByEmail(Email.create('MARIA@TON.COM.BR'))).resolves.not.toBeNull();
  });

  it('devolve null para e-mail desconhecido', async () => {
    const repo = new InMemoryUserRepository([usuario()]);

    await expect(repo.findByEmail(Email.create('ninguem@ton.com.br'))).resolves.toBeNull();
  });

  it('grava um usuário novo', async () => {
    const repo = new InMemoryUserRepository();
    await repo.save(usuario());

    await expect(repo.findByEmail(Email.create('maria@ton.com.br'))).resolves.not.toBeNull();
  });

  it('avança a versão a cada escrita', async () => {
    const repo = new InMemoryUserRepository([usuario()]);
    await repo.save(usuario({ failedLoginAttempts: 1 }));

    const salvo = await repo.findByEmail(Email.create('maria@ton.com.br'));
    expect(salvo?.version).toBe(2);
  });

  it('recusa escrita baseada em versão desatualizada', async () => {
    // Espelha a ConditionExpression do DynamoDB. Sem isso, duas tentativas de
    // login simultâneas sobrescreveriam o contador e anulariam o bloqueio.
    const repo = new InMemoryUserRepository([usuario()]);
    const lido = await repo.findByEmail(Email.create('maria@ton.com.br'));

    await repo.save(usuario({ failedLoginAttempts: 1 }));

    await expect(
      repo.save(usuario({ ...lido!.toProps(), failedLoginAttempts: 9 })),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('em escritas concorrentes, exatamente uma vence', async () => {
    const repo = new InMemoryUserRepository([usuario()]);
    const lido = (await repo.findByEmail(Email.create('maria@ton.com.br')))!;

    const resultados = await Promise.allSettled([
      repo.save(User.create({ ...lido.toProps(), failedLoginAttempts: 1 })),
      repo.save(User.create({ ...lido.toProps(), failedLoginAttempts: 1 })),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DynamoDbUserRepository } from '../../src/infrastructure/persistence/dynamodb';
import { User } from '../../src/domain/entities';
import { ConcurrencyError } from '../../src/domain/errors';
import { Email, LockoutPolicy, PasswordHash } from '../../src/domain/value-objects';
import { createTestTable, type TestTable } from './support';

const AGORA = new Date('2026-09-06T12:00:00.000Z');
const policy = LockoutPolicy.create({
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 900_000,
});

let table: TestTable;
let repo: DynamoDbUserRepository;
let sufixo = 0;

const novoUsuario = (): User =>
  User.create({
    id: `user-${String((sufixo += 1))}`,
    email: Email.create(`maria${String(sufixo)}@ton.com.br`),
    passwordHash: PasswordHash.create('$argon2id$hash'),
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    createdAt: AGORA,
    version: 0,
  });

describe('DynamoDbUserRepository', () => {
  beforeAll(async () => {
    table = await createTestTable('users');
    repo = new DynamoDbUserRepository(table.clients.documents, table.tableName);
  });

  afterAll(async () => {
    await table.drop();
  });

  let usuario: User;

  beforeEach(async () => {
    usuario = novoUsuario();
    await repo.save(usuario);
  });

  it('encontra pelo e-mail usando o índice', async () => {
    const achado = await repo.findByEmail(usuario.email);

    expect(achado?.id).toBe(usuario.id);
    expect(achado?.email.value).toBe(usuario.email.value);
  });

  it('devolve nulo para e-mail desconhecido', async () => {
    await expect(repo.findByEmail(Email.create('ninguem@ton.com.br'))).resolves.toBeNull();
  });

  it('preserva o hash da senha na ida e na volta', async () => {
    const achado = await repo.findByEmail(usuario.email);

    expect(achado?.passwordHash.value).toBe('$argon2id$hash');
  });

  describe('controle de concorrência', () => {
    it('avança a versão a cada escrita', async () => {
      const lido = await repo.findByEmail(usuario.email);

      expect(lido?.version).toBe(1);
    });

    it('recusa escrita baseada em versão desatualizada', async () => {
      const lido = (await repo.findByEmail(usuario.email))!;
      await repo.save(lido);

      await expect(repo.save(lido)).rejects.toBeInstanceOf(ConcurrencyError);
    });

    it('em escritas simultâneas, exatamente uma vence', async () => {
      // A ConditionExpression sobre a versão é o que impede que duas
      // atualizações se sobrescrevam em silêncio.
      const lido = (await repo.findByEmail(usuario.email))!;

      const resultados = await Promise.allSettled([repo.save(lido), repo.save(lido)]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });
  });

  describe('contador de tentativas', () => {
    it('incrementa e devolve o total', async () => {
      const atual = (await repo.findByEmail(usuario.email))!;

      const depois = await repo.registerFailedLogin(atual, AGORA, policy);

      expect(depois.failedLoginAttempts).toBe(1);
    });

    it('cem tentativas simultâneas contam cem', async () => {
      // É o motivo de o incremento ser feito pelo banco. Ler e regravar faria
      // todas lerem o mesmo total e gravarem por cima umas das outras, e o
      // bloqueio deixaria de valer contra ataque automatizado.
      const atual = (await repo.findByEmail(usuario.email))!;

      await Promise.all(
        Array.from({ length: 100 }, () => repo.registerFailedLogin(atual, AGORA, policy)),
      );

      const final = await repo.findByEmail(usuario.email);
      expect(final?.failedLoginAttempts).toBe(100);
    });

    it('aplica o bloqueio ao atingir o limite da política', async () => {
      let atual = (await repo.findByEmail(usuario.email))!;

      for (let i = 0; i < 5; i += 1) {
        atual = await repo.registerFailedLogin(atual, AGORA, policy);
      }

      expect(atual.isLocked(AGORA)).toBe(true);
      const persistido = await repo.findByEmail(usuario.email);
      expect(persistido?.isLocked(AGORA)).toBe(true);
    });

    it('recusa contabilizar falha para usuário inexistente, sem criar registro', async () => {
      // Sem a condição de existência, o `ADD` cria o item: o banco ficaria com
      // um registro parcial permanente, só com chave e contador, e reconstruir
      // a entidade quebraria com erro de tipo em vez de resposta prevista.
      const fantasma = User.create({
        id: 'usuario-que-nunca-existiu',
        email: Email.create('fantasma@ton.com.br'),
        passwordHash: PasswordHash.create('$argon2id$x'),
        failedLoginAttempts: 0,
        lockedUntil: undefined,
        createdAt: AGORA,
        version: 0,
      });

      await expect(repo.registerFailedLogin(fantasma, AGORA, policy)).rejects.toBeInstanceOf(
        ConcurrencyError,
      );
      await expect(repo.findById('usuario-que-nunca-existiu')).resolves.toBeNull();
    });

    it('a aplicação do bloqueio também avança a versão', async () => {
      let atual = (await repo.findByEmail(usuario.email))!;
      const versaoInicial = atual.version;

      for (let i = 0; i < 5; i += 1) {
        atual = await repo.registerFailedLogin(atual, AGORA, policy);
      }

      const persistido = (await repo.findByEmail(usuario.email))!;
      // Cinco incrementos mais a escrita do bloqueio.
      expect(persistido.version).toBe(versaoInicial + 6);
      expect(atual.version).toBe(persistido.version);
    });

    it('tentativas simultâneas no limiar deixam o maior bloqueio, não o último', async () => {
      // A ConditionExpression de monotonicidade é o que garante isso. Sem ela, a
      // requisição que calculou o bloqueio menor pode gravar por último e
      // encurtar a punição — bastaria atacar em paralelo para manter o bloqueio
      // no mínimo (issue #24).
      const atual = (await repo.findByEmail(usuario.email))!;

      // Vinte falhas de uma vez: várias cruzam o limiar juntas, cada uma
      // calculando uma duração diferente a partir do contador que recebeu. Com
      // esta política, a partir da décima falha a duração satura no teto, então
      // o maior bloqueio possível é conhecido: 15 minutos após AGORA.
      const resultados = await Promise.all(
        Array.from({ length: 20 }, () => repo.registerFailedLogin(atual, AGORA, policy)),
      );

      const persistido = (await repo.findByEmail(usuario.email))!;

      expect(persistido.failedLoginAttempts).toBe(20);
      expect(persistido.lockedUntil).toEqual(new Date(AGORA.getTime() + 900_000));

      // E nenhuma chamada anuncia um bloqueio maior do que o que ficou gravado:
      // o retorno é o estado real, não a reconstrução do que ela mesma calculou.
      for (const r of resultados) {
        expect(r.lockedUntil?.getTime() ?? 0).toBeLessThanOrEqual(
          persistido.lockedUntil!.getTime(),
        );
      }
    });

    it('não bloqueia antes do limite', async () => {
      let atual = (await repo.findByEmail(usuario.email))!;

      for (let i = 0; i < 4; i += 1) {
        atual = await repo.registerFailedLogin(atual, AGORA, policy);
      }

      expect(atual.isLocked(AGORA)).toBe(false);
    });
  });
});

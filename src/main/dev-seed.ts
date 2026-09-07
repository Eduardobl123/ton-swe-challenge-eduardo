import { Email, Money } from '../domain/value-objects';
import { Product, User } from '../domain/entities';
import type { Container } from './container';

export interface DevSeedCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Carga inicial para desenvolvimento local.
 *
 * Sem ela, subir a aplicação com os adaptadores em memória entrega uma API que
 * ninguém consegue exercitar: não há usuário para autenticar nem produto para
 * listar, e o `curl` do README vira promessa. Os dados de verdade chegam com o
 * script de carga contra o DynamoDB (issue #7).
 *
 * **Nunca roda em produção.** A senha é conhecida e está no `.env.example`;
 * criar essa conta em um ambiente real seria uma porta aberta com a chave
 * publicada junto.
 */
export async function seedForDevelopment(
  container: Container,
  credentials: DevSeedCredentials,
): Promise<void> {
  if (container.config.isProduction) {
    throw new Error('A carga de desenvolvimento não pode ser executada em produção.');
  }

  const { users, products, passwordHasher, clock, idGenerator } = container.seeding;
  const now = clock.now();

  await users.save(
    User.create({
      id: idGenerator.next(),
      email: Email.create(credentials.email),
      passwordHash: await passwordHasher.hash(credentials.password),
      failedLoginAttempts: 0,
      lockedUntil: undefined,
      createdAt: now,
      version: 0,
    }),
  );

  for (let i = 1; i <= 42; i += 1) {
    await products.add(
      Product.create({
        id: idGenerator.next(),
        sku: `TON-${String(i).padStart(3, '0')}`,
        name: `Produto de demonstração ${String(i)}`,
        description: 'Item criado pela carga inicial de desenvolvimento.',
        price: Money.fromCents(1_000 + i * 137),
        active: true,
        // Datas distintas e crescentes, para que a ordenação da listagem seja
        // observável ao navegar as páginas.
        createdAt: new Date(now.getTime() - (42 - i) * 60_000),
      }),
    );
  }
}

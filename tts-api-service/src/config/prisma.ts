/**
 * PrismaClient singleton (skills.md Dependency Inversion: infrastructure is
 * created here, not inside business logic). Postgres is the source of truth.
 */
import { PrismaClient } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Liveness ping used by health checks. */
export async function pingPostgres(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

import { PrismaClient } from '@prisma/client';
import { env, isProd } from './env';

/**
 * PrismaClient is expensive to instantiate and holds a connection pool.
 * A single shared singleton is reused for the lifetime of the process; in
 * development we also stash it on `globalThis` so hot-reloaders (tsx watch)
 * do not leak a new pool on every file change.
 */
declare global {
  // eslint-disable-next-line no-var
  var __medistockPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__medistockPrisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) {
  global.__medistockPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

// Referenced only so tree-shakers keep `env` imported where side effects matter.
export const prismaDatasourceUrl = env.DATABASE_URL;

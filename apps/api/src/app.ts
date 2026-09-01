import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';

import { env, isProd } from './config/env';
import { prisma } from './config/prisma';
import { redis } from './config/redis';
import './lib/redis-scripts';

import authPlugin from './plugins/auth.plugin';
import errorHandlerPlugin from './plugins/error-handler.plugin';

import authRoutes from './routes/auth.routes';
import medicineRoutes from './routes/medicine.routes';
import reservationRoutes from './routes/reservation.routes';
import inventoryRoutes from './routes/inventory.routes';
import pharmacyRoutes from './routes/pharmacy.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          },
    },
    trustProxy: true,
    bodyLimit: 16 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: true } },
  });

  // ── Security / infra plugins ───────────────────────────────────────────
  await app.register(helmet, { global: true });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'medistock-rl:',
  });

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  // ── Health / readiness ────────────────────────────────────────────────
  app.get('/health', async () => {
    const [db, cache] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redis.ping(),
    ]);
    const healthy = db.status === 'fulfilled' && cache.status === 'fulfilled';
    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { database: db.status, redis: cache.status },
      timestamp: new Date().toISOString(),
    };
  });

  // ── API v1 ────────────────────────────────────────────────────────────
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(medicineRoutes, { prefix: '/medicines' });
      await v1.register(reservationRoutes, { prefix: '/reservations' });
      await v1.register(inventoryRoutes, { prefix: '/inventory' });
      await v1.register(pharmacyRoutes, { prefix: '/pharmacies' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}

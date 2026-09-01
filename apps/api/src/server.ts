import { buildApp } from './app';
import { env } from './config/env';
import { disconnectPrisma } from './config/prisma';
import { closeRedis } from './config/redis';
import { closeReservationQueue } from './queues/reservation.queue';
import { createExpiryWorker } from './workers/expiry.worker';

async function main(): Promise<void> {
  const app = await buildApp();

  let inProcessWorker: ReturnType<typeof createExpiryWorker> | undefined;
  if (env.RUN_WORKER_IN_PROCESS) {
    inProcessWorker = createExpiryWorker();
    app.log.info('in-process BullMQ expiry worker started');
  }

  await app.listen({ host: env.HOST, port: env.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'graceful shutdown initiated');

    try {
      await app.close();
      if (inProcessWorker) {
        await inProcessWorker.close();
      }
      await closeReservationQueue();
      await disconnectPrisma();
      await closeRedis();
      app.log.info('graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during graceful shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException — exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('failed to start MediStock API', err);
  process.exit(1);
});

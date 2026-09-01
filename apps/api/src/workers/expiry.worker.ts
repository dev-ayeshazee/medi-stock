import { Worker, type Job } from 'bullmq';
import { bullConnection, closeRedis } from '../config/redis';
import { disconnectPrisma } from '../config/prisma';
import { env } from '../config/env';
import {
  BULLMQ_PREFIX,
  RESERVATION_EXPIRY_QUEUE,
  closeReservationQueue,
  type ReservationExpiryJobData,
} from '../queues/reservation.queue';
import { expireReservation } from '../services/reservation.service';

/**
 * Background auto-reclamation worker.
 *
 * When a hold's 30-minute timer fires, this processor calls
 * `expireReservation`, which — only if the hold is still PENDING — flips it to
 * EXPIRED and returns the units to availability in both Postgres and Redis.
 * Claims/cancels that happened first leave the hold non-PENDING, so the job is
 * a safe no-op. BullMQ retries with exponential backoff on transient failure.
 */
export function createExpiryWorker(): Worker<ReservationExpiryJobData> {
  const worker = new Worker<ReservationExpiryJobData>(
    RESERVATION_EXPIRY_QUEUE,
    async (job: Job<ReservationExpiryJobData>) => expireReservation(job.data.reservationId),
    {
      connection: bullConnection(),
      prefix: BULLMQ_PREFIX,
      concurrency: env.EXPIRY_WORKER_CONCURRENCY,
      lockDuration: 30_000,
    },
  );

  worker.on('completed', (job, result) => {
    // eslint-disable-next-line no-console
    console.log(`[expiry.worker] job=${job.id} -> ${JSON.stringify(result)}`);
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[expiry.worker] job=${job?.id ?? 'unknown'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[expiry.worker] ${err.message}`);
  });

  return worker;
}

async function main(): Promise<void> {
  const worker = createExpiryWorker();
  // eslint-disable-next-line no-console
  console.log(
    `[expiry.worker] listening on "${RESERVATION_EXPIRY_QUEUE}" (concurrency=${env.EXPIRY_WORKER_CONCURRENCY})`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[expiry.worker] ${signal} received — draining in-flight jobs`);
    try {
      await worker.close();
      await closeReservationQueue();
      await disconnectPrisma();
      await closeRedis();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[expiry.worker] error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  void main();
}

import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from '../config/redis';

export const RESERVATION_EXPIRY_QUEUE = 'reservation-expiry';

/** Redis key namespace for all BullMQ structures. */
export const BULLMQ_PREFIX = 'medistock';

export interface ReservationExpiryJobData {
  reservationId: string;
}

/**
 * Delayed-job queue that drives auto-reclamation. One job is enqueued per hold
 * with `delay = TTL`; the job id equals the reservation id so we can cancel it
 * on early claim/cancel and so a duplicate enqueue is de-duplicated by BullMQ.
 */
export const reservationExpiryQueue = new Queue<ReservationExpiryJobData>(RESERVATION_EXPIRY_QUEUE, {
  connection: bullConnection(),
  prefix: BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 24 * 3_600 },
  },
});

export function scheduleReservationExpiry(reservationId: string, delayMs: number) {
  const opts: JobsOptions = { jobId: reservationId, delay: delayMs };
  return reservationExpiryQueue.add('expire', { reservationId }, opts);
}

/** Best-effort cancellation of a pending delayed job (claim / manual cancel). */
export async function removeReservationExpiryJob(jobId: string): Promise<void> {
  const job = await reservationExpiryQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

export async function closeReservationQueue(): Promise<void> {
  await reservationExpiryQueue.close();
}

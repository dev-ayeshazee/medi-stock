import { Prisma, ReservationStatus, Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { redis, stockKey } from '../config/redis';
import { env } from '../config/env';
import '../lib/redis-scripts';
import { generateOtp } from '../lib/otp';
import { reservationView } from '../lib/serializers';
import {
  ConflictError,
  ForbiddenError,
  InsufficientStockError,
  NotFoundError,
} from '../lib/errors';
import {
  scheduleReservationExpiry,
  removeReservationExpiryJob,
} from '../queues/reservation.queue';
import type { AuthUser } from '../types/auth';

const TTL_MS = env.RESERVATION_TTL_MINUTES * 60_000;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Idempotently seed the Redis stock hash from the Postgres row. */
async function seedStockKey(inventoryId: string, total: number, held: number): Promise<void> {
  await redis.initStock(stockKey(inventoryId), total, held);
}

interface LockedReservationRow {
  id: string;
  status: ReservationStatus;
  code: string;
  quantity: number;
  patientId: string;
  pharmacyId: string;
  inventoryId: string;
  jobId: string | null;
  expiresAt: Date;
}

/** `SELECT ... FOR UPDATE` — serialises concurrent claim/expire/cancel on one row. */
function lockReservation(
  tx: Prisma.TransactionClient,
  reservationId: string,
): Promise<LockedReservationRow[]> {
  return tx.$queryRaw<LockedReservationRow[]>(Prisma.sql`
    SELECT id, status, code, quantity, "patientId", "pharmacyId",
           "inventoryId", "jobId", "expiresAt"
    FROM "Reservation"
    WHERE id = ${reservationId}::uuid
    FOR UPDATE
  `);
}

// ── 1. Atomic hold ───────────────────────────────────────────────────────

export interface HoldParams {
  patientId: string;
  inventoryId: string;
  quantity: number;
}

/**
 * Places a 30-minute hold on `quantity` units of an inventory row.
 *
 * Overselling is prevented by `holdStock.lua`, which performs the
 * `(total - held) >= requested` check and the `held += requested` increment as
 * one indivisible Redis operation. Only after Redis has accepted the hold do we
 * write the durable record; if that DB transaction fails we compensate the
 * Redis counter back down.
 */
export async function holdReservation(params: HoldParams) {
  const { patientId, inventoryId, quantity } = params;

  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { pharmacy: true, medicine: true },
  });
  if (!inventory) {
    throw new NotFoundError('Inventory item not found');
  }
  if (inventory.pharmacy.status !== 'VERIFIED') {
    throw new ForbiddenError('Pharmacy is not verified');
  }

  const key = stockKey(inventoryId);
  await seedStockKey(inventoryId, inventory.totalStock, inventory.heldStock);

  let result = await redis.holdStock(key, quantity);

  // Stock hash was evicted / flushed between seed and hold — reseed and retry once.
  if (result === -1) {
    await redis.initStock(key, inventory.totalStock, inventory.heldStock);
    result = await redis.holdStock(key, quantity);
  }

  if (result === -3) {
    throw new ConflictError('Invalid reservation quantity');
  }
  if (result === -1 || result === -2) {
    throw new InsufficientStockError();
  }

  // Redis hold succeeded. Persist durably; roll the Redis counter back on failure.
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: inventoryId },
        data: { heldStock: { increment: quantity }, version: { increment: 1 } },
      });

      return tx.reservation.create({
        data: {
          code: generateOtp(),
          status: ReservationStatus.PENDING,
          quantity,
          patientId,
          pharmacyId: inventory.pharmacyId,
          medicineId: inventory.medicineId,
          inventoryId,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    });

    const job = await scheduleReservationExpiry(created.id, TTL_MS);

    const withRelations = await prisma.reservation.update({
      where: { id: created.id },
      data: { jobId: job.id ?? created.id },
      include: { pharmacy: true, medicine: true },
    });

    return reservationView(withRelations, true);
  } catch (error) {
    await redis.releaseStock(key, quantity).catch(() => undefined);
    throw error;
  }
}

// ── 2. Pharmacy claim / fulfilment ───────────────────────────────────────

export interface ClaimParams {
  actor: AuthUser;
  reservationId: string;
  otpCode: string;
}

/**
 * Marks a PENDING reservation CLAIMED and permanently consumes the stock:
 * `totalStock` and `heldStock` both drop by `quantity` in Postgres (inside the
 * row-locked transaction) and then in Redis via `commitStock.lua`.
 */
export async function claimReservation(params: ClaimParams) {
  const { actor, reservationId, otpCode } = params;

  let pharmacyScope: string | null = null;
  if (actor.role !== Role.ADMIN) {
    if (!actor.pharmacyId) {
      throw new ForbiddenError('User is not linked to a pharmacy');
    }
    pharmacyScope = actor.pharmacyId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const [row] = await lockReservation(tx, reservationId);

    if (!row) {
      throw new NotFoundError('Reservation not found');
    }
    if (pharmacyScope && row.pharmacyId !== pharmacyScope) {
      throw new ForbiddenError('Reservation belongs to another pharmacy');
    }
    if (row.status !== ReservationStatus.PENDING) {
      throw new ConflictError(`Reservation is already ${row.status}`);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictError('Reservation has expired');
    }
    if (row.code !== otpCode) {
      throw new ConflictError('Invalid OTP code');
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE "Inventory"
      SET "totalStock" = GREATEST("totalStock" - ${row.quantity}, 0),
          "heldStock"  = GREATEST("heldStock"  - ${row.quantity}, 0),
          "version"    = "version" + 1,
          "updatedAt"  = now()
      WHERE id = ${row.inventoryId}::uuid
    `);

    return tx.reservation.update({
      where: { id: row.id },
      data: { status: ReservationStatus.CLAIMED, claimedAt: new Date() },
      include: { pharmacy: true, medicine: true },
    });
  });

  await redis.commitStock(stockKey(updated.inventoryId), updated.quantity).catch(() => undefined);
  await removeReservationExpiryJob(updated.jobId ?? updated.id).catch(() => undefined);

  return reservationView(updated, false);
}

// ── 3 & 3b. Release (auto-expiry + manual cancel) ────────────────────────

export type ReleaseOutcome =
  | {
      changed: true;
      status: ReservationStatus;
      reservationId: string;
      releasedQuantity: number;
    }
  | {
      changed: false;
      reason: 'NOT_FOUND' | 'NOT_PENDING';
      status?: ReservationStatus;
    };

interface ReleaseParams {
  reservationId: string;
  toStatus: Extract<ReservationStatus, 'EXPIRED' | 'CANCELLED'>;
  requirePatientId?: string;
}

/**
 * Shared release path. Inside a row-locked transaction it flips a still-PENDING
 * hold to EXPIRED/CANCELLED and decrements `heldStock` (floored at 0). Redis is
 * then reconciled with `releaseStock.lua`, making the units immediately
 * available again. Any non-PENDING state is treated as "already handled".
 */
type TxRelease =
  | { kind: 'not_found' }
  | { kind: 'not_pending'; status: ReservationStatus }
  | { kind: 'released'; reservationId: string; quantity: number; inventoryId: string };

async function releaseReservation(params: ReleaseParams): Promise<ReleaseOutcome> {
  const { reservationId, toStatus, requirePatientId } = params;

  const result = await prisma.$transaction(async (tx): Promise<TxRelease> => {
    const [row] = await lockReservation(tx, reservationId);

    if (!row) {
      return { kind: 'not_found' };
    }
    if (requirePatientId && row.patientId !== requirePatientId) {
      throw new ForbiddenError('Reservation belongs to another patient');
    }
    if (row.status !== ReservationStatus.PENDING) {
      return { kind: 'not_pending', status: row.status };
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE "Inventory"
      SET "heldStock" = GREATEST("heldStock" - ${row.quantity}, 0),
          "version"   = "version" + 1,
          "updatedAt" = now()
      WHERE id = ${row.inventoryId}::uuid
    `);

    await tx.reservation.update({
      where: { id: row.id },
      data: { status: toStatus, releasedAt: new Date() },
    });

    return {
      kind: 'released',
      reservationId: row.id,
      quantity: row.quantity,
      inventoryId: row.inventoryId,
    };
  });

  if (result.kind === 'not_found') {
    return { changed: false, reason: 'NOT_FOUND' };
  }
  if (result.kind === 'not_pending') {
    return { changed: false, reason: 'NOT_PENDING', status: result.status };
  }

  await redis
    .releaseStock(stockKey(result.inventoryId), result.quantity)
    .catch(() => undefined);

  return {
    changed: true,
    status: toStatus,
    reservationId: result.reservationId,
    releasedQuantity: result.quantity,
  };
}

/** Invoked by the BullMQ expiry worker. */
export function expireReservation(reservationId: string): Promise<ReleaseOutcome> {
  return releaseReservation({ reservationId, toStatus: ReservationStatus.EXPIRED });
}

/** Invoked by the patient via `POST /reservations/cancel`. */
export async function cancelReservation(reservationId: string, patientId: string) {
  const outcome = await releaseReservation({
    reservationId,
    toStatus: ReservationStatus.CANCELLED,
    requirePatientId: patientId,
  });

  if (!outcome.changed && outcome.reason === 'NOT_FOUND') {
    throw new NotFoundError('Reservation not found');
  }
  if (!outcome.changed && outcome.reason === 'NOT_PENDING') {
    throw new ConflictError(`Reservation is already ${outcome.status}`);
  }

  await removeReservationExpiryJob(reservationId).catch(() => undefined);
  return outcome;
}

// ── 4. Reads ─────────────────────────────────────────────────────────────

export async function getReservationForUser(reservationId: string, actor: AuthUser) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { pharmacy: true, medicine: true },
  });
  if (!reservation) {
    throw new NotFoundError('Reservation not found');
  }

  if (actor.role === Role.PATIENT && reservation.patientId !== actor.sub) {
    throw new ForbiddenError('Reservation belongs to another patient');
  }
  if (actor.role === Role.PHARMACIST && reservation.pharmacyId !== actor.pharmacyId) {
    throw new ForbiddenError('Reservation belongs to another pharmacy');
  }

  // OTP is echoed to the owning patient and to admins, never to a pharmacist.
  const includeOtp = actor.role !== Role.PHARMACIST;
  return reservationView(reservation, includeOtp);
}

export async function listReservationsForUser(
  actor: AuthUser,
  filters: { status?: ReservationStatus; limit: number },
) {
  const where: Prisma.ReservationWhereInput = {};

  if (actor.role === Role.PATIENT) {
    where.patientId = actor.sub;
  } else if (actor.role === Role.PHARMACIST) {
    where.pharmacyId = actor.pharmacyId ?? '__none__';
  }
  if (filters.status) {
    where.status = filters.status;
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: { pharmacy: true, medicine: true },
    orderBy: { createdAt: 'desc' },
    take: filters.limit,
  });

  const includeOtp = actor.role !== Role.PHARMACIST;
  return reservations.map((reservation) => reservationView(reservation, includeOtp));
}

import { prisma } from '../config/prisma';
import { redis, stockKey } from '../config/redis';
import { ConflictError, NotFoundError } from '../lib/errors';
import type { BatchSyncItem } from '../validators/inventory.schema';

export interface BatchSyncResult {
  batchId: string;
  status: 'PROCESSED' | 'ALREADY_PROCESSED';
  processed: number;
  skipped: number;
}

/** Upsert chunk size — keeps each transaction small so the POS never long-locks a table. */
const UPSERT_CHUNK = 100;

/**
 * Idempotent bulk inventory ingestion.
 *
 *  - A previously seen `batchId` short-circuits to a no-op.
 *  - Medicines are resolved (get-or-create by natural key) once, up front.
 *  - Rows are upserted in small chunked transactions keyed on
 *    `(pharmacyId, medicineId)`, so concurrent POS pushes never block on a
 *    table-wide lock.
 *  - Redis stock hashes are refreshed with the new totals (held is preserved),
 *    so proximity search and the atomic-hold path see fresh numbers at once.
 */
export async function batchSyncInventory(params: {
  pharmacyId: string;
  batchId: string;
  items: BatchSyncItem[];
}): Promise<BatchSyncResult> {
  const { pharmacyId, batchId, items } = params;

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
  if (!pharmacy) {
    throw new NotFoundError('Pharmacy not found');
  }

  const alreadyProcessed = await prisma.inventorySyncBatch.findUnique({ where: { batchId } });
  if (alreadyProcessed) {
    return { batchId, status: 'ALREADY_PROCESSED', processed: 0, skipped: items.length };
  }

  // 1. Resolve every row to a concrete medicineId (create-or-get) before the
  //    hot upsert loop, and collapse duplicate SKUs within the batch.
  const resolved = new Map<string, { item: BatchSyncItem; medicineId: string }>();

  for (const item of items) {
    let medicineId = item.medicineId;

    if (!medicineId) {
      const medicine = await prisma.medicine.upsert({
        where: {
          name_strength_form_brand: {
            name: item.medicineName!,
            strength: item.strength!,
            form: item.form!,
            brand: item.brand ?? '',
          },
        },
        create: {
          name: item.medicineName!,
          strength: item.strength!,
          form: item.form!,
          brand: item.brand ?? '',
          genericFormula: item.genericFormula!,
        },
        update: {},
        select: { id: true },
      });
      medicineId = medicine.id;
    } else {
      const exists = await prisma.medicine.findUnique({
        where: { id: medicineId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundError(`Medicine ${medicineId} referenced by SKU ${item.sku} not found`);
      }
    }

    // Last write for a given medicine within the batch wins.
    resolved.set(medicineId, { item, medicineId });
  }

  const resolvedList = [...resolved.values()];

  // 2. Chunked, idempotent upserts.
  let processed = 0;
  try {
    for (let offset = 0; offset < resolvedList.length; offset += UPSERT_CHUNK) {
      const chunk = resolvedList.slice(offset, offset + UPSERT_CHUNK);

      await prisma.$transaction(
        chunk.map(({ item, medicineId }) =>
          prisma.inventory.upsert({
            where: { pharmacyId_medicineId: { pharmacyId, medicineId } },
            create: {
              pharmacyId,
              medicineId,
              sku: item.sku,
              totalStock: item.totalStock,
              heldStock: 0,
              priceCents: item.priceCents,
              currency: item.currency,
              lastSyncedAt: new Date(),
            },
            update: {
              sku: item.sku,
              totalStock: item.totalStock,
              priceCents: item.priceCents,
              currency: item.currency,
              version: { increment: 1 },
              lastSyncedAt: new Date(),
            },
          }),
        ),
      );

      processed += chunk.length;
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError('A SKU in this batch collides with an existing inventory row');
    }
    throw error;
  }

  // 3. Refresh Redis totals (preserve any live `held`); create the hash if absent.
  const updatedInventories = await prisma.inventory.findMany({
    where: { pharmacyId, medicineId: { in: resolvedList.map((r) => r.medicineId) } },
    select: { id: true, totalStock: true },
  });

  const pipeline = redis.pipeline();
  for (const inventory of updatedInventories) {
    pipeline.hset(stockKey(inventory.id), 'total', inventory.totalStock);
    pipeline.hsetnx(stockKey(inventory.id), 'held', 0);
  }
  await pipeline.exec();

  // 4. Record the batch so a replay is a no-op.
  await prisma.inventorySyncBatch.create({
    data: { batchId, pharmacyId, itemCount: items.length },
  });

  return { batchId, status: 'PROCESSED', processed, skipped: items.length - processed };
}

export async function listInventory(pharmacyId: string, limit: number) {
  const items = await prisma.inventory.findMany({
    where: { pharmacyId },
    include: { medicine: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  return items.map((item) => ({
    id: item.id,
    sku: item.sku,
    totalStock: item.totalStock,
    heldStock: item.heldStock,
    availableStock: item.totalStock - item.heldStock,
    price: { amountCents: item.priceCents, currency: item.currency },
    version: item.version,
    lastSyncedAt: item.lastSyncedAt,
    medicine: {
      id: item.medicine.id,
      name: item.medicine.name,
      brand: item.medicine.brand || null,
      genericFormula: item.medicine.genericFormula,
      strength: item.medicine.strength,
      form: item.medicine.form,
      isCritical: item.medicine.isCritical,
    },
  }));
}

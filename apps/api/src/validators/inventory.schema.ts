import { z } from 'zod';
import { env } from '../config/env';

/**
 * One line of a POS batch. A row may reference an existing medicine by
 * `medicineId`, or describe it by natural key (`genericFormula` + `strength` +
 * `form`, optionally `brand`/`medicineName`) so the medicine is created on the
 * fly during ingestion.
 */
export const batchSyncItemSchema = z
  .object({
    sku: z.string().trim().min(1).max(80),
    medicineId: z.string().uuid().optional(),
    medicineName: z.string().trim().min(2).max(160).optional(),
    genericFormula: z.string().trim().min(2).max(160).optional(),
    strength: z.string().trim().min(1).max(60).optional(),
    form: z.string().trim().min(2).max(60).optional(),
    brand: z.string().trim().max(160).optional(),
    totalStock: z.coerce.number().int().min(0),
    priceCents: z.coerce.number().int().min(0),
    currency: z.string().trim().length(3).toUpperCase().default('USD'),
  })
  .refine(
    (item) =>
      Boolean(item.medicineId) ||
      Boolean(item.genericFormula && item.strength && item.form && item.medicineName),
    {
      message:
        'Each item needs either medicineId, or medicineName + genericFormula + strength + form',
      path: ['medicineId'],
    },
  );
export type BatchSyncItem = z.infer<typeof batchSyncItemSchema>;

export const batchSyncSchema = z.object({
  // Client-generated stable id; replaying the same value is a safe no-op.
  batchId: z.string().trim().min(8).max(120),
  // ADMIN callers may target any pharmacy; PHARMACIST callers are pinned to their own.
  pharmacyId: z.string().uuid().optional(),
  items: z.array(batchSyncItemSchema).min(1).max(env.BATCH_SYNC_MAX_ITEMS),
});
export type BatchSyncInput = z.infer<typeof batchSyncSchema>;

/** Query params accepted alongside a `text/csv` body. */
export const batchSyncCsvQuerySchema = z.object({
  batchId: z.string().trim().min(8).max(120),
  pharmacyId: z.string().uuid().optional(),
});

export const listInventoryQuerySchema = z.object({
  pharmacyId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

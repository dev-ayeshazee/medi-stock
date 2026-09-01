import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { ForbiddenError } from '../lib/errors';
import { parseCsv } from '../lib/csv';
import { batchSyncInventory, listInventory } from '../services/inventory.service';
import {
  batchSyncCsvQuerySchema,
  batchSyncSchema,
  listInventoryQuerySchema,
  type BatchSyncItem,
} from '../validators/inventory.schema';

/** Maps one parsed CSV record onto the batch-item shape before Zod validation. */
function csvRecordToItem(record: Record<string, string>): Record<string, unknown> {
  return {
    sku: record.sku,
    medicineId: record.medicineId || undefined,
    medicineName: record.medicineName || undefined,
    genericFormula: record.genericFormula || undefined,
    strength: record.strength || undefined,
    form: record.form || undefined,
    brand: record.brand || undefined,
    totalStock: record.totalStock,
    priceCents: record.priceCents,
    currency: record.currency || 'USD',
  };
}

export default async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // Accept raw CSV bodies in addition to JSON.
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  /**
   * Batch POS inventory ingestion.
   *  - JSON:  body = { batchId, pharmacyId?, items: [...] }
   *  - CSV :  header row + rows; batchId / pharmacyId come from the query string.
   * Idempotent on `batchId`.
   */
  app.post(
    '/batch-sync',
    { preHandler: [app.authenticate, app.authorize(Role.PHARMACIST, Role.ADMIN)] },
    async (request, reply) => {
      const actor = request.currentUser;

      let batchId: string;
      let requestedPharmacyId: string | undefined;
      let items: BatchSyncItem[];

      if (typeof request.body === 'string') {
        const q = batchSyncCsvQuerySchema.parse(request.query);
        const parsed = batchSyncSchema.parse({
          batchId: q.batchId,
          pharmacyId: q.pharmacyId,
          items: parseCsv(request.body).map(csvRecordToItem),
        });
        batchId = parsed.batchId;
        requestedPharmacyId = parsed.pharmacyId;
        items = parsed.items;
      } else {
        const parsed = batchSyncSchema.parse(request.body);
        batchId = parsed.batchId;
        requestedPharmacyId = parsed.pharmacyId;
        items = parsed.items;
      }

      // Resolve the target pharmacy and enforce tenant isolation.
      let targetPharmacyId: string | null;
      if (actor.role === Role.ADMIN) {
        targetPharmacyId = requestedPharmacyId ?? null;
      } else {
        if (requestedPharmacyId && requestedPharmacyId !== actor.pharmacyId) {
          throw new ForbiddenError('Pharmacists may only sync their own pharmacy');
        }
        targetPharmacyId = actor.pharmacyId;
      }
      if (!targetPharmacyId) {
        throw new ForbiddenError('No target pharmacy resolved for this sync');
      }

      const result = await batchSyncInventory({ pharmacyId: targetPharmacyId, batchId, items });
      return reply.code(result.status === 'ALREADY_PROCESSED' ? 200 : 202).send(result);
    },
  );

  app.get(
    '/',
    { preHandler: [app.authenticate, app.authorize(Role.PHARMACIST, Role.ADMIN)] },
    async (request) => {
      const actor = request.currentUser;
      const { pharmacyId, limit } = listInventoryQuerySchema.parse(request.query);

      const targetPharmacyId = actor.role === Role.ADMIN ? pharmacyId : actor.pharmacyId;
      if (!targetPharmacyId) {
        throw new ForbiddenError('No pharmacy resolved for this request');
      }

      const items = await listInventory(targetPharmacyId, limit);
      return { pharmacyId: targetPharmacyId, count: items.length, items };
    },
  );
}

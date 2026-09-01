import { z } from 'zod';
import { env } from '../config/env';

/**
 * `GET /api/v1/medicines/search` query.
 *
 * Coordinates and radius are coerced from the query string. Exactly one of
 * `medicineId` (exact match) or `genericFormula` (salt-level substitution) must
 * be supplied.
 */
export const searchQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce
      .number()
      .positive()
      .max(env.GEO_MAX_RADIUS_KM)
      .default(env.GEO_DEFAULT_RADIUS_KM),
    medicineId: z.string().uuid().optional(),
    genericFormula: z.string().trim().min(2).max(160).optional(),
    limit: z.coerce.number().int().positive().max(env.GEO_MAX_RESULTS).default(25),
  })
  .refine((value) => Boolean(value.medicineId) || Boolean(value.genericFormula), {
    message: 'Provide either medicineId or genericFormula',
    path: ['medicineId'],
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const createMedicineSchema = z.object({
  name: z.string().trim().min(2).max(160),
  brand: z.string().trim().max(160).optional(),
  genericFormula: z.string().trim().min(2).max(160),
  strength: z.string().trim().min(1).max(60),
  form: z.string().trim().min(2).max(60),
  isCritical: z.boolean().default(false),
});
export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;

export const listMedicinesQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  critical: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListMedicinesQuery = z.infer<typeof listMedicinesQuerySchema>;

import { z } from 'zod';
import { PharmacyStatus } from '@prisma/client';
import { registerSchema } from './auth.schema';

export const createPharmacySchema = z.object({
  name: z.string().trim().min(2).max(160),
  licenseNo: z.string().trim().min(3).max(80),
  address: z.string().trim().min(4).max(240),
  phone: z.string().trim().min(6).max(24),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  status: z.nativeEnum(PharmacyStatus).optional(),
});
export type CreatePharmacyInput = z.infer<typeof createPharmacySchema>;

export const updatePharmacyStatusSchema = z.object({
  status: z.nativeEnum(PharmacyStatus),
});
export type UpdatePharmacyStatusInput = z.infer<typeof updatePharmacyStatusSchema>;

export const createPharmacistSchema = registerSchema;
export type CreatePharmacistInput = z.infer<typeof createPharmacistSchema>;

export const pharmacyIdParamSchema = z.object({
  id: z.string().uuid(),
});

import { z } from 'zod';
import { env } from '../config/env';

export const holdReservationSchema = z.object({
  inventoryId: z.string().uuid(),
  quantity: z.coerce.number().int().positive().max(env.MAX_HOLD_QUANTITY),
});
export type HoldReservationInput = z.infer<typeof holdReservationSchema>;

export const claimReservationSchema = z.object({
  reservationId: z.string().uuid(),
  otpCode: z.string().regex(/^\d{6}$/, 'otpCode must be a 6-digit string'),
});
export type ClaimReservationInput = z.infer<typeof claimReservationSchema>;

export const cancelReservationSchema = z.object({
  reservationId: z.string().uuid(),
});
export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const reservationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listReservationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;

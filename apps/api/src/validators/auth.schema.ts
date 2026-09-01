import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().toLowerCase().max(160),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(24).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().max(160),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

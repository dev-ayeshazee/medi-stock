import type { Role } from '@prisma/client';

/**
 * Decoded JWT identity attached to every authenticated request.
 * `sub` is the User.id; `pharmacyId` is populated only for PHARMACIST users.
 */
export interface AuthUser {
  sub: string;
  email: string;
  role: Role;
  pharmacyId: string | null;
}

import type { Medicine, Pharmacy, Reservation, User } from '@prisma/client';

/** Strips the password hash and other internal columns before returning a user. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    pharmacyId: user.pharmacyId,
    createdAt: user.createdAt,
  };
}

export function publicPharmacy(pharmacy: Pharmacy) {
  return {
    id: pharmacy.id,
    name: pharmacy.name,
    licenseNo: pharmacy.licenseNo,
    status: pharmacy.status,
    address: pharmacy.address,
    phone: pharmacy.phone,
    latitude: pharmacy.latitude,
    longitude: pharmacy.longitude,
    createdAt: pharmacy.createdAt,
  };
}

export function publicMedicine(medicine: Medicine) {
  return {
    id: medicine.id,
    name: medicine.name,
    brand: medicine.brand || null,
    genericFormula: medicine.genericFormula,
    strength: medicine.strength,
    form: medicine.form,
    isCritical: medicine.isCritical,
  };
}

type ReservationWithRelations = Reservation & {
  pharmacy?: Pharmacy | null;
  medicine?: Medicine | null;
};

/**
 * @param includeOtp  the OTP is only echoed back to the reservation owner (and
 *                     admins). Pharmacists must obtain it from the patient.
 */
export function reservationView(reservation: ReservationWithRelations, includeOtp: boolean) {
  return {
    id: reservation.id,
    status: reservation.status,
    quantity: reservation.quantity,
    otpCode: includeOtp ? reservation.code : undefined,
    inventoryId: reservation.inventoryId,
    expiresAt: reservation.expiresAt,
    claimedAt: reservation.claimedAt,
    releasedAt: reservation.releasedAt,
    createdAt: reservation.createdAt,
    pharmacy: reservation.pharmacy
      ? {
          id: reservation.pharmacy.id,
          name: reservation.pharmacy.name,
          address: reservation.pharmacy.address,
          phone: reservation.pharmacy.phone,
          latitude: reservation.pharmacy.latitude,
          longitude: reservation.pharmacy.longitude,
        }
      : undefined,
    medicine: reservation.medicine ? publicMedicine(reservation.medicine) : undefined,
  };
}

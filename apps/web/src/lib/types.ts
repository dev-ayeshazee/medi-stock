// Shapes returned by the MediStock API (apps/api). Kept deliberately small —
// only the fields the UI consumes.

export type Role = 'PATIENT' | 'PHARMACIST' | 'ADMIN';
export type PharmacyStatus = 'PENDING' | 'VERIFIED' | 'SUSPENDED';
export type ReservationStatus = 'PENDING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  pharmacyId: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Medicine {
  id: string;
  name: string;
  brand: string | null;
  genericFormula: string;
  strength: string;
  form: string;
  isCritical: boolean;
}

export interface Money {
  amountCents: number;
  currency: string;
}

export interface SearchResult {
  inventoryId: string;
  distanceKm: number;
  availableStock: number;
  sku: string;
  price: Money;
  medicine: Medicine;
  pharmacy: {
    id: string;
    name: string;
    address: string;
    phone: string;
    latitude: number;
    longitude: number;
  };
}

export interface SearchResponse {
  query: {
    lat: number;
    lon: number;
    radiusKm: number;
    medicineId: string | null;
    genericFormula: string | null;
  };
  count: number;
  results: SearchResult[];
}

export interface Reservation {
  id: string;
  status: ReservationStatus;
  quantity: number;
  otpCode?: string;
  inventoryId: string;
  expiresAt: string;
  claimedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  pharmacy?: {
    id: string;
    name: string;
    address: string;
    phone: string;
    latitude: number;
    longitude: number;
  };
  medicine?: Medicine;
}

export interface ReleaseOutcome {
  changed: boolean;
  reason?: string;
  status?: ReservationStatus;
  reservationId?: string;
  releasedQuantity?: number;
}

export interface InventoryItem {
  id: string;
  sku: string;
  totalStock: number;
  heldStock: number;
  availableStock: number;
  price: Money;
  version: number;
  lastSyncedAt: string;
  medicine: Medicine;
}

export interface BatchSyncResult {
  batchId: string;
  status: 'PROCESSED' | 'ALREADY_PROCESSED';
  processed: number;
  skipped: number;
}

export interface Pharmacy {
  id: string;
  name: string;
  licenseNo: string;
  status: PharmacyStatus;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

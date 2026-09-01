import { api } from '../lib/api';
import type { Pharmacy, PharmacyStatus, User } from '../lib/types';

export interface CreatePharmacyBody {
  name: string;
  licenseNo: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  status?: PharmacyStatus;
}

export interface CreateStaffBody {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export const pharmaciesApi = {
  list: () => api<{ count: number; pharmacies: Pharmacy[] }>('/pharmacies'),

  create: (body: CreatePharmacyBody) =>
    api<{ pharmacy: Pharmacy }>('/pharmacies', { method: 'POST', json: body }),

  setStatus: (id: string, status: PharmacyStatus) =>
    api<{ pharmacy: Pharmacy }>(`/pharmacies/${id}/status`, { method: 'PATCH', json: { status } }),

  addStaff: (id: string, body: CreateStaffBody) =>
    api<{ user: User }>(`/pharmacies/${id}/staff`, { method: 'POST', json: body }),

  rebuildGeo: () => api<{ indexed: number }>('/pharmacies/geo/rebuild', { method: 'POST' }),
};

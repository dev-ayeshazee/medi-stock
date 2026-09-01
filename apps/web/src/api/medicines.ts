import { api } from '../lib/api';
import type { Medicine, SearchResponse } from '../lib/types';

export interface SearchParams {
  lat: number;
  lon: number;
  radiusKm: number;
  medicineId?: string;
  genericFormula?: string;
  limit?: number;
}

export interface CreateMedicineBody {
  name: string;
  brand?: string;
  genericFormula: string;
  strength: string;
  form: string;
  isCritical: boolean;
}

export const medicinesApi = {
  search: (params: SearchParams) =>
    api<SearchResponse>('/medicines/search', { query: { ...params } }),

  list: (params: { q?: string; critical?: boolean; limit?: number } = {}) =>
    api<{ count: number; medicines: Medicine[] }>('/medicines', {
      query: {
        q: params.q,
        critical: params.critical === undefined ? undefined : String(params.critical),
        limit: params.limit,
      },
    }),

  create: (body: CreateMedicineBody) =>
    api<{ medicine: Medicine }>('/medicines', { method: 'POST', json: body }),
};

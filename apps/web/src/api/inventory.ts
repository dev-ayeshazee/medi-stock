import { api } from '../lib/api';
import type { BatchSyncResult, InventoryItem } from '../lib/types';

export interface BatchSyncItem {
  sku: string;
  medicineId?: string;
  medicineName?: string;
  genericFormula?: string;
  strength?: string;
  form?: string;
  brand?: string;
  totalStock: number;
  priceCents: number;
  currency?: string;
}

export interface BatchSyncBody {
  batchId: string;
  pharmacyId?: string;
  items: BatchSyncItem[];
}

export const inventoryApi = {
  list: (params: { pharmacyId?: string; limit?: number } = {}) =>
    api<{ pharmacyId: string; count: number; items: InventoryItem[] }>('/inventory', {
      query: { ...params },
    }),

  batchSyncJson: (body: BatchSyncBody) =>
    api<BatchSyncResult>('/inventory/batch-sync', { method: 'POST', json: body }),

  batchSyncCsv: (csv: string, params: { batchId: string; pharmacyId?: string }) =>
    api<BatchSyncResult>('/inventory/batch-sync', {
      method: 'POST',
      body: csv,
      headers: { 'Content-Type': 'text/csv' },
      query: { ...params },
    }),
};

import { api } from '../lib/api';
import type { Reservation, ReleaseOutcome, ReservationStatus } from '../lib/types';

export const reservationsApi = {
  hold: (body: { inventoryId: string; quantity: number }) =>
    api<{ reservation: Reservation }>('/reservations/hold', { method: 'POST', json: body }),

  claim: (body: { reservationId: string; otpCode: string }) =>
    api<{ reservation: Reservation }>('/reservations/claim', { method: 'POST', json: body }),

  cancel: (body: { reservationId: string }) =>
    api<{ outcome: ReleaseOutcome }>('/reservations/cancel', { method: 'POST', json: body }),

  list: (params: { status?: ReservationStatus; limit?: number } = {}) =>
    api<{ count: number; reservations: Reservation[] }>('/reservations', { query: { ...params } }),

  get: (id: string) => api<{ reservation: Reservation }>(`/reservations/${id}`),
};

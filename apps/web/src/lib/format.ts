import type { Money } from './types';

export function formatMoney({ amountCents, currency }: Money): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      amountCents / 100,
    );
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Milliseconds remaining until `iso`, floored at 0. */
export function msUntil(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

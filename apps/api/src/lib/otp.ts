import { randomInt } from 'node:crypto';

/**
 * Cryptographically-uniform 6-digit code, zero-padded ("000000"–"999999").
 * `randomInt` is rejection-sampled internally, so there is no modulo bias.
 */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

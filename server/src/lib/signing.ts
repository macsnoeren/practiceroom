import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

/**
 * Signs/verifies short-lived playback URLs. The signature binds a recording id
 * to an expiry timestamp; combined with the per-request viewer check on the
 * stream route, a leaked link is useless to a non-participant and stops working
 * after it expires.
 */
export function signPlayback(recordingId: string, expires: number): string {
  return createHmac('sha256', env.SIGNING_SECRET).update(`${recordingId}.${expires}`).digest('hex');
}

export function verifyPlayback(recordingId: string, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signPlayback(recordingId, expires);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

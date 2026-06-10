import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

export const PLAYBACK_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Distinct resource strings so a recording signature can't open a composite. */
export const recordingResource = (recordingId: string) => `rec:${recordingId}`;
export const compositeResource = (lessonId: string) => `composite:${lessonId}`;
export const libraryResource = (itemId: string) => `lib:${itemId}`;

/**
 * Signs/verifies short-lived playback URLs. The signature binds a resource to
 * an expiry; combined with the per-request viewer check on the stream route, a
 * leaked link is useless to a non-participant and stops working after expiry.
 */
export function signPlayback(resource: string, expires: number): string {
  return createHmac('sha256', env.SIGNING_SECRET).update(`${resource}.${expires}`).digest('hex');
}

export function verifyPlayback(resource: string, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signPlayback(resource, expires);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

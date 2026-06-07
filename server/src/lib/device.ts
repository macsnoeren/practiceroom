import { createHash, randomBytes, randomInt } from 'node:crypto';

// Unambiguous alphabet (no 0/O/1/I) for human-typed pairing codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export const PAIRING_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Long, high-entropy bearer token handed to a paired camera device. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/** Store only the hash of a device token (it is random, so sha256 is enough). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

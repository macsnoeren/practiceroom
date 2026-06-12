import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env.js';

/**
 * Symmetric encryption for secrets stored at rest (e.g. TOTP secrets), so a
 * leaked database file does not hand an attacker usable secrets. AES-256-GCM
 * gives both confidentiality and tamper detection (the auth tag).
 *
 * The 32-byte key is derived from `ENCRYPTION_KEY` via sha256 so any key length
 * configured in the environment works. The stored format is three base64 parts
 * joined by dots: `iv.tag.ciphertext`.
 */
const key = createHash('sha256').update(env.ENCRYPTION_KEY).digest();

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/**
 * Reverses {@link encryptSecret}. Throws if the payload is malformed, the key is
 * wrong, or the ciphertext was tampered with — callers that must not break on a
 * bad value should catch and treat the result as invalid.
 */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with argon2id (the @node-rs build ships prebuilt binaries,
 * so there is no native compilation step). Defaults are secure; we keep them.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  return verify(passwordHash, plain);
}

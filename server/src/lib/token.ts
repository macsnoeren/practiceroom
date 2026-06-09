import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';

export type TokenType = 'email_verify' | 'password_reset' | 'invite';

/** How long each kind of token stays valid. */
const TTL_MS: Record<TokenType, number> = {
  email_verify: 24 * 60 * 60 * 1000, // 24 hours
  invite: 7 * 24 * 60 * 60 * 1000, // 7 days
  password_reset: 60 * 60 * 1000, // 1 hour
};

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Creates a single-use token of the given type for a user. Any existing,
 * unused token of the same type is removed first so only the latest link
 * works. Returns the raw token (to put in an e-mail link); only its hash is
 * stored.
 */
export async function createToken(userId: string, type: TokenType): Promise<string> {
  const raw = randomBytes(32).toString('hex');
  await prisma.$transaction([
    prisma.token.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.token.create({
      data: {
        userId,
        type,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + TTL_MS[type]),
      },
    }),
  ]);
  return raw;
}

/**
 * Validates and consumes a token. Returns the owning userId, or null when the
 * token is unknown, of the wrong type, already used or expired. Marking it used
 * is atomic (a conditional update) so a token cannot be redeemed twice.
 */
export async function consumeToken(raw: string, type: TokenType): Promise<string | null> {
  const token = await prisma.token.findUnique({ where: { tokenHash: hash(raw) } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    return null;
  }
  const result = await prisma.token.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) return null; // lost a race; already consumed
  return token.userId;
}

/** Reads a still-valid token without consuming it (for invite preview). */
export async function peekToken(raw: string, type: TokenType): Promise<string | null> {
  const token = await prisma.token.findUnique({ where: { tokenHash: hash(raw) } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return token.userId;
}

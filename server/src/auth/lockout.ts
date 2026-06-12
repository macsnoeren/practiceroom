import { prisma } from '../db.js';

/** Lock an account after this many consecutive failed logins... */
const LOCK_THRESHOLD = 5;
/** ...for this long. Account-based, so it also slows a distributed (many-IP)
 * brute force that the per-IP rate limiter cannot see. */
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Whether the account is currently within an active lockout window. */
export function isAccountLocked(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

/**
 * Records a failed login. Increments the counter and, once it reaches the
 * threshold, sets a lockout window and resets the counter so the next series of
 * failures must build up again.
 */
export async function registerFailedLogin(userId: string): Promise<void> {
  const { failedLoginCount } = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (failedLoginCount >= LOCK_THRESHOLD) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + LOCK_WINDOW_MS), failedLoginCount: 0 },
    });
  }
}

/** Clears the failure counter and any lock after a successful login (no write
 * when there is nothing to clear). */
export async function clearFailedLogins(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}

import { randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../db.js';

export const SESSION_COOKIE = 'pr_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function generateSessionId(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

/** Resolve a session token to its user, deleting it if expired. */
export async function getSessionUser(sessionId: string): Promise<User | null> {
  return (await getSessionContext(sessionId))?.user ?? null;
}

/** Like getSessionUser, but also exposes the superadmin's entered school. */
export async function getSessionContext(
  sessionId: string,
): Promise<{ user: User; activeSchoolId: string | null } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await deleteSession(sessionId);
    return null;
  }
  return { user: session.user, activeSchoolId: session.activeSchoolId };
}

/** Set (or clear) the school a superadmin session is currently acting within. */
export async function setActiveSchool(sessionId: string, schoolId: string | null): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId }, data: { activeSchoolId: schoolId } });
}

export async function deleteSession(sessionId: string): Promise<void> {
  // Ignore "record not found" — the end state (no session) is what we want.
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

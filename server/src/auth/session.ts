import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../db.js';

export const SESSION_COOKIE = 'pr_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** The cookie carries this high-entropy token; only its hash is stored, so a
 * leaked database cannot be used to hijack live sessions. */
function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/** Resolve a session token to its user, deleting it if expired. */
export async function getSessionUser(token: string): Promise<User | null> {
  return (await getSessionContext(token))?.user ?? null;
}

/**
 * The fully resolved session: the raw user, the superadmin's entered school, and
 * the EFFECTIVE school + role for this request. The effective values drive all
 * tenant-scoped access:
 *  - a superadmin acts as 'admin' of the school they have entered (if any);
 *  - any other user acts in the membership for their active school, or — when no
 *    active school is set or it is no longer valid — their first membership.
 * `effectiveSchoolId`/`effectiveRole` are null when the user has no school yet.
 */
export interface SessionContext {
  user: User;
  activeSchoolId: string | null;
  effectiveSchoolId: string | null;
  effectiveRole: 'admin' | 'teacher' | 'student' | null;
}

export async function getSessionContext(token: string): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await deleteSession(token);
    return null;
  }

  const { user, activeSchoolId } = session;

  if (user.role === 'superadmin') {
    // Acts as admin of the school they have entered, or has no school context.
    return {
      user,
      activeSchoolId,
      effectiveSchoolId: activeSchoolId,
      effectiveRole: activeSchoolId ? 'admin' : null,
    };
  }

  // Members: the active school's membership, else the oldest membership.
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  const active =
    (activeSchoolId ? memberships.find((m) => m.schoolId === activeSchoolId) : undefined) ??
    memberships[0] ??
    null;

  return {
    user,
    activeSchoolId,
    effectiveSchoolId: active?.schoolId ?? null,
    effectiveRole: (active?.role as SessionContext['effectiveRole']) ?? null,
  };
}

/** Set (or clear) the school a superadmin session is currently acting within. */
export async function setActiveSchool(token: string, schoolId: string | null): Promise<void> {
  await prisma.session.updateMany({
    where: { id: hashToken(token) },
    data: { activeSchoolId: schoolId },
  });
}

export async function deleteSession(token: string): Promise<void> {
  // Ignore "record not found" — the end state (no session) is what we want.
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

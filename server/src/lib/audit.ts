import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

/** In-flight audit writes, so tests can deterministically wait for them. */
const pending = new Set<Promise<unknown>>();

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Records a security-relevant event (login, account and device changes) both in
 * the structured logs and in the `AuditLog` table for the site administrator to
 * review. The DB write is fire-and-forget so it never blocks or fails a request;
 * searchable columns (school, user, email, ip) are derived from the request and
 * the details, with the full context kept as a JSON `detail` blob.
 */
export function audit(
  request: FastifyRequest,
  event: string,
  details: Record<string, unknown> = {},
): void {
  request.log.info({ audit: event, ip: request.ip, ...details }, `audit: ${event}`);

  const principal = request.principal;
  const schoolId =
    request.authUser?.schoolId ??
    principal?.activeSchoolId ??
    principal?.schoolId ??
    asString(details.schoolId);
  const userId = principal?.userId ?? asString(details.userId);
  const hasDetails = Object.keys(details).length > 0;

  const write = prisma.auditLog
    .create({
      data: {
        action: event,
        schoolId,
        userId,
        email: asString(details.email),
        ip: request.ip,
        detail: hasDetails ? JSON.stringify(details) : null,
      },
    })
    .catch(() => undefined)
    .finally(() => pending.delete(write));
  pending.add(write);
}

/** Test helper: resolve once all in-flight audit writes have settled. */
export async function flushAudit(): Promise<void> {
  await Promise.allSettled([...pending]);
}

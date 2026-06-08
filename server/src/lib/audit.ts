import type { FastifyRequest } from 'fastify';

/**
 * Records a security-relevant event in the structured logs (login, account and
 * device changes). These lines carry an `audit` field so they can be filtered.
 */
export function audit(
  request: FastifyRequest,
  event: string,
  details: Record<string, unknown> = {},
): void {
  request.log.info({ audit: event, ip: request.ip, ...details }, `audit: ${event}`);
}

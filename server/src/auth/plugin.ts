import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@practiceroom/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { getSessionUser, SESSION_COOKIE } from './session.js';

/** The authenticated user as attached to each request (no password hash). */
export interface AuthUser {
  id: string;
  schoolId: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

/**
 * Attaches `request.authUser` (or null) on every request by resolving the
 * session cookie. Must be registered AFTER @fastify/cookie so cookies are
 * already parsed.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest('authUser', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await getSessionUser(token);
    if (user) {
      request.authUser = {
        id: user.id,
        schoolId: user.schoolId,
        email: user.email,
        name: user.name,
        role: user.role as Role,
      };
    }
  });
}

/** Use inside a handler to get the current user, or fail with 401. */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

/** preHandler that requires the user to be authenticated and have one of the roles. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (request) => {
    const user = requireAuth(request);
    if (!roles.includes(user.role)) throw forbidden();
  };
}

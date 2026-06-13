import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role, UserRole } from '@practiceroom/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { getSessionContext, SESSION_COOKIE } from './session.js';

/** The authenticated user as attached to each request (no password hash). For a
 * superadmin this represents the school they have entered (acting as its admin). */
export interface AuthUser {
  id: string;
  schoolId: string;
  email: string;
  name: string;
  role: Role;
}

/** The raw signed-in identity, including a site-wide superadmin (no school). */
export interface Principal {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  schoolId: string | null; // the user's own school (null for a superadmin)
  activeSchoolId: string | null; // the school a superadmin has entered
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
    principal: Principal | null;
  }
}

/**
 * Attaches `request.principal` (raw identity) and `request.authUser` (effective
 * school-scoped user) on every request by resolving the session cookie. A
 * superadmin only gets an `authUser` once they have entered a school, where
 * they then act as that school's admin.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest('authUser', null);
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const ctx = await getSessionContext(token);
    if (!ctx) return;
    const { user, activeSchoolId, effectiveSchoolId, effectiveRole } = ctx;

    request.principal = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      schoolId: user.schoolId,
      activeSchoolId,
    };

    // The effective school + role come from the resolved membership (or the
    // superadmin's entered school). No school context = no authUser.
    if (effectiveSchoolId && effectiveRole) {
      request.authUser = {
        id: user.id,
        schoolId: effectiveSchoolId,
        email: user.email,
        name: user.name,
        role: effectiveRole as Role,
      };
    }
  });
}

/** Use inside a handler to get the current user, or fail with 401. */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

/** Use inside a handler to require a site-wide superadmin. */
export function requireSuperadmin(request: FastifyRequest): Principal {
  const principal = request.principal;
  if (!principal) throw unauthorized();
  if (principal.role !== 'superadmin') throw forbidden();
  return principal;
}

/** preHandler that requires the user to be authenticated and have one of the roles. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (request) => {
    const user = requireAuth(request);
    if (!roles.includes(user.role)) throw forbidden();
  };
}

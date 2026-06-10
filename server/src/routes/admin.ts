import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CreateSchoolSchema,
  EnterSchoolSchema,
  SiteAdminSetupSchema,
  UpdateUserSchema,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { cookieSecure } from '../env.js';
import { hashPassword } from '../auth/password.js';
import { createSession, setActiveSchool, SESSION_COOKIE } from '../auth/session.js';
import { requireSuperadmin } from '../auth/plugin.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { toGlobalUserDto, toSchoolSummaryDto, toUserDto } from '../lib/dto.js';
import { sensitiveRateLimit } from '../lib/rate-limit.js';
import { audit } from '../lib/audit.js';

function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

async function superadminExists(): Promise<boolean> {
  return (await prisma.user.count({ where: { role: 'superadmin' } })) > 0;
}

/** Site-wide administration: a superadmin (no school) manages the whole site and
 * can "enter" any school to act as its admin. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Whether the one-time site-admin setup is still needed (public).
  app.get('/api/admin/setup-status', async () => {
    return { exists: await superadminExists() };
  });

  // Create the first site administrator. Only works while none exists.
  app.post('/api/admin/setup', sensitiveRateLimit, async (request, reply) => {
    if (await superadminExists()) throw forbidden('Er bestaat al een sitebeheerder');
    const input = SiteAdminSetupSchema.parse(request.body);

    const taken = await prisma.user.findUnique({ where: { email: input.email } });
    if (taken) throw conflict('E-mailadres is al in gebruik');

    const passwordHash = await hashPassword(input.password);
    const admin = await prisma.user.create({
      data: {
        schoolId: null,
        email: input.email,
        name: input.name,
        role: 'superadmin',
        emailVerified: true,
        passwordHash,
      },
    });
    const session = await createSession(admin.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    audit(request, 'siteadmin.setup', { userId: admin.id });
    return reply.code(201).send(toUserDto(admin, null));
  });

  // All schools with a couple of counts, for the site dashboard.
  app.get('/api/admin/schools', async (request) => {
    requireSuperadmin(request);
    const schools = await prisma.school.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true, lessons: true } } },
    });
    return schools.map(toSchoolSummaryDto);
  });

  // Create a new (empty) school. The site admin can then enter it to add users.
  app.post('/api/admin/schools', async (request, reply) => {
    requireSuperadmin(request);
    const { name } = CreateSchoolSchema.parse(request.body);
    const school = await prisma.school.create({ data: { name } });
    audit(request, 'siteadmin.school.create', { schoolId: school.id });
    return reply.code(201).send(toSchoolSummaryDto(school));
  });

  // Enter a school: from now on this superadmin session acts as that school's admin.
  app.post('/api/admin/enter', async (request) => {
    const principal = requireSuperadmin(request);
    const { schoolId } = EnterSchoolSchema.parse(request.body);
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw notFound('School niet gevonden');

    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw badRequest('Geen sessie');
    await setActiveSchool(token, schoolId);
    audit(request, 'siteadmin.enter', { schoolId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    return toUserDto(user, schoolId);
  });

  // Leave the school and return to the site dashboard.
  app.post('/api/admin/leave', async (request) => {
    const principal = requireSuperadmin(request);
    const token = request.cookies[SESSION_COOKIE];
    if (token) await setActiveSchool(token, null);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    return toUserDto(user, null);
  });

  /* ---- Global user management (across all schools) ------------------------- */

  app.get('/api/admin/users', async (request) => {
    requireSuperadmin(request);
    const users = await prisma.user.findMany({
      orderBy: [{ schoolId: 'asc' }, { createdAt: 'asc' }],
      include: { school: { select: { name: true } } },
    });
    return users.map(toGlobalUserDto);
  });

  app.patch('/api/admin/users/:id', async (request) => {
    const principal = requireSuperadmin(request);
    const { id } = request.params as { id: string };
    const input = UpdateUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('Gebruiker niet gevonden');
    if (existing.role === 'superadmin') throw forbidden('Sitebeheerders kun je hier niet bewerken');

    if (input.email && input.email !== existing.email) {
      const taken = await prisma.user.findUnique({ where: { email: input.email } });
      if (taken) throw conflict('E-mailadres is al in gebruik');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
      include: { school: { select: { name: true } } },
    });
    audit(request, 'siteadmin.user.update', { userId: id, by: principal.userId });
    return toGlobalUserDto(updated);
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const principal = requireSuperadmin(request);
    const { id } = request.params as { id: string };
    if (id === principal.userId) throw badRequest('Je kunt je eigen account niet verwijderen');

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('Gebruiker niet gevonden');
    if (existing.role === 'superadmin')
      throw forbidden('Sitebeheerders kun je hier niet verwijderen');

    await prisma.user.delete({ where: { id } });
    audit(request, 'siteadmin.user.delete', { userId: id, by: principal.userId });
    return reply.code(204).send();
  });
}

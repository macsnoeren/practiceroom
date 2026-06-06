import type { FastifyInstance, FastifyReply } from 'fastify';
import { LoginSchema, RegisterSchoolSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/session.js';
import { requireAuth } from '../auth/plugin.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { toSchoolDto, toUserDto } from '../lib/dto.js';

function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

// Stricter limit on credential endpoints to slow brute-force / abuse.
const sensitiveLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Bootstrap a school + its first admin. Open by design for a self-hosted
  // install; tighten or disable once the school exists (see Phase 8).
  app.post('/api/auth/register-school', sensitiveLimit, async (request, reply) => {
    const input = RegisterSchoolSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('E-mailadres is al in gebruik');

    const passwordHash = await hashPassword(input.password);
    const { school, admin } = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({ data: { name: input.schoolName } });
      const admin = await tx.user.create({
        data: {
          schoolId: school.id,
          email: input.email,
          name: input.adminName,
          role: 'admin',
          passwordHash,
        },
      });
      return { school, admin };
    });

    const session = await createSession(admin.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    return reply.code(201).send({ user: toUserDto(admin), school: toSchoolDto(school) });
  });

  app.post('/api/auth/login', sensitiveLimit, async (request, reply) => {
    const input = LoginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Spend similar time as a real verify to reduce user enumeration.
      await hashPassword(input.password);
      throw unauthorized('Onjuiste inloggegevens');
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw unauthorized('Onjuiste inloggegevens');

    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    return toUserDto(user);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const authUser = requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) throw unauthorized();
    return toUserDto(user);
  });
}

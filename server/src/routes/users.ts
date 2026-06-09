import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CreateUserSchema, UpdateUserSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toUserDto } from '../lib/dto.js';
import { audit } from '../lib/audit.js';
import { createToken } from '../lib/token.js';
import { sendInviteEmail } from '../lib/mailer.js';

interface IdParam {
  id: string;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Admin creates a teacher or student within their OWN school. Without a
  // password the user is created unverified and invited by e-mail to set one
  // themselves; with a password they are created ready to use.
  app.post('/api/users', { preHandler: requireRole('admin') }, async (request, reply) => {
    const admin = requireAuth(request);
    const input = CreateUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('E-mailadres is al in gebruik');

    const invite = !input.password;
    // For an invite, store an unusable random hash until they choose a password.
    const passwordHash = await hashPassword(input.password ?? randomBytes(32).toString('hex'));
    const user = await prisma.user.create({
      data: {
        schoolId: admin.schoolId, // tenant scope: always the admin's own school
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
        emailVerified: !invite,
      },
    });

    if (invite) {
      const token = await createToken(user.id, 'invite');
      await sendInviteEmail(user.email, user.name, token);
    }

    audit(request, 'user.create', { userId: user.id, role: user.role, invite });
    return reply.code(201).send(toUserDto(user));
  });

  // List users in the caller's own school only (tenant isolation).
  app.get('/api/users', { preHandler: requireRole('admin', 'teacher') }, async (request) => {
    const me = requireAuth(request);
    const users = await prisma.user.findMany({
      where: { schoolId: me.schoolId },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toUserDto);
  });

  // Admin edits a user in their school (name, email, role, password reset).
  app.patch('/api/users/:id', { preHandler: requireRole('admin') }, async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const input = UpdateUserSchema.parse(request.body);

    const existing = await prisma.user.findFirst({ where: { id, schoolId: me.schoolId } });
    if (!existing) throw notFound('Gebruiker niet gevonden');

    // Prevent an admin from demoting themselves into a lockout.
    if (id === me.id && input.role && input.role !== 'admin') {
      throw badRequest('Je kunt je eigen beheerdersrol niet wijzigen');
    }
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
    });
    audit(request, 'user.update', { userId: id });
    return toUserDto(updated);
  });

  app.delete('/api/users/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    if (id === me.id) throw badRequest('Je kunt je eigen account niet verwijderen');

    const result = await prisma.user.deleteMany({ where: { id, schoolId: me.schoolId } });
    if (result.count === 0) throw notFound('Gebruiker niet gevonden');
    audit(request, 'user.delete', { userId: id });
    return reply.code(204).send();
  });
}

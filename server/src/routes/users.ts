import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CreateUserSchema, UpdateUserSchema, type UserRole } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toUserDto } from '../lib/dto.js';
import { audit } from '../lib/audit.js';
import { createToken } from '../lib/token.js';
import { sendAddedToSchoolEmail, sendInviteEmail } from '../lib/mailer.js';

interface IdParam {
  id: string;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Admin adds a teacher or student to their OWN school. A brand-new e-mail gets
  // a (global) account; an existing e-mail (someone already in another school)
  // simply gains a membership of this school. Without a password a new account is
  // invited by e-mail to set one; an existing account is just notified.
  app.post('/api/users', { preHandler: requireRole('admin') }, async (request, reply) => {
    const admin = requireAuth(request);
    const input = CreateUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: true },
    });

    // Existing account → add a membership for this school (a person can belong to
    // several schools, with a role per school).
    if (existing) {
      if (existing.role === 'superadmin') {
        throw badRequest('Sitebeheerders kun je niet aan een school toevoegen');
      }
      if (existing.memberships.some((m) => m.schoolId === admin.schoolId)) {
        throw conflict('Deze persoon zit al in jouw school');
      }
      await prisma.membership.create({
        data: { userId: existing.id, schoolId: admin.schoolId, role: input.role },
      });
      const school = await prisma.school.findUnique({ where: { id: admin.schoolId } });
      await sendAddedToSchoolEmail(existing.email, existing.name, school?.name ?? 'een school');
      audit(request, 'user.add_membership', { userId: existing.id, role: input.role });
      return reply.code(201).send(toUserDto(existing, null, { schoolId: admin.schoolId, role: input.role }));
    }

    const invite = !input.password;
    // For an invite, store an unusable random hash until they choose a password.
    const passwordHash = await hashPassword(input.password ?? randomBytes(32).toString('hex'));
    const user = await prisma.user.create({
      data: {
        schoolId: admin.schoolId, // home school (legacy/display)
        email: input.email,
        name: input.name,
        role: input.role, // legacy/display; membership below is authoritative
        passwordHash,
        emailVerified: !invite,
        memberships: { create: { schoolId: admin.schoolId, role: input.role } },
      },
    });

    if (invite) {
      const token = await createToken(user.id, 'invite');
      await sendInviteEmail(user.email, user.name, token);
    }

    audit(request, 'user.create', { userId: user.id, role: input.role, invite });
    return reply.code(201).send(toUserDto(user, null, { schoolId: admin.schoolId, role: input.role }));
  });

  // List the members of the caller's own school (tenant isolation), each with
  // their role in this school.
  app.get('/api/users', { preHandler: requireRole('admin', 'teacher') }, async (request) => {
    const me = requireAuth(request);
    const memberships = await prisma.membership.findMany({
      where: { schoolId: me.schoolId },
      orderBy: { createdAt: 'asc' },
      include: { user: true },
    });
    return memberships.map((m) =>
      toUserDto(m.user, null, { schoolId: me.schoolId, role: m.role as UserRole }),
    );
  });

  // Admin edits a member of their school. Role changes apply to the membership
  // (this school only); name/email/password are on the global account and so
  // affect all of that person's schools.
  app.patch('/api/users/:id', { preHandler: requireRole('admin') }, async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const input = UpdateUserSchema.parse(request.body);

    const membership = await prisma.membership.findUnique({
      where: { userId_schoolId: { userId: id, schoolId: me.schoolId } },
      include: { user: true },
    });
    if (!membership) throw notFound('Gebruiker niet gevonden');

    // Prevent an admin from demoting themselves into a lockout.
    if (id === me.id && input.role && input.role !== 'admin') {
      throw badRequest('Je kunt je eigen beheerdersrol niet wijzigen');
    }
    if (input.email && input.email !== membership.user.email) {
      const taken = await prisma.user.findUnique({ where: { email: input.email } });
      if (taken) throw conflict('E-mailadres is al in gebruik');
    }

    if (input.role && input.role !== membership.role) {
      await prisma.membership.update({
        where: { userId_schoolId: { userId: id, schoolId: me.schoolId } },
        data: { role: input.role },
      });
    }
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
    });
    audit(request, 'user.update', { userId: id });
    const role = (input.role ?? membership.role) as UserRole;
    return toUserDto(user, null, { schoolId: me.schoolId, role });
  });

  // Remove a member from this school: drops the membership only. If it was their
  // last school, the (now school-less) account is deleted to avoid orphans.
  app.delete('/api/users/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    if (id === me.id) throw badRequest('Je kunt je eigen account niet verwijderen');

    const result = await prisma.membership.deleteMany({
      where: { userId: id, schoolId: me.schoolId },
    });
    if (result.count === 0) throw notFound('Gebruiker niet gevonden');

    const remaining = await prisma.membership.count({ where: { userId: id } });
    if (remaining === 0) {
      // No schools left: remove the account entirely (never a superadmin here).
      await prisma.user.deleteMany({ where: { id, role: { not: 'superadmin' } } });
    }
    audit(request, 'user.delete', { userId: id, accountRemoved: remaining === 0 });
    return reply.code(204).send();
  });
}

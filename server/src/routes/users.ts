import type { FastifyInstance } from 'fastify';
import { CreateUserSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { conflict } from '../lib/errors.js';
import { toUserDto } from '../lib/dto.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Admin creates a teacher or student within their OWN school.
  app.post('/api/users', { preHandler: requireRole('admin') }, async (request, reply) => {
    const admin = requireAuth(request);
    const input = CreateUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('E-mailadres is al in gebruik');

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        schoolId: admin.schoolId, // tenant scope: always the admin's own school
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      },
    });

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
}

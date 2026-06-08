import type { FastifyInstance } from 'fastify';
import { CreateRoomSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { notFound } from '../lib/errors.js';
import { toRoomDto } from '../lib/dto.js';

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  // Everyone in the school can list rooms (to assign/filter); admin manages them.
  app.get('/api/rooms', async (request) => {
    const me = requireAuth(request);
    const rooms = await prisma.room.findMany({
      where: { schoolId: me.schoolId },
      orderBy: { name: 'asc' },
    });
    return rooms.map(toRoomDto);
  });

  app.post('/api/rooms', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const { name } = CreateRoomSchema.parse(request.body);
    const room = await prisma.room.create({ data: { schoolId: me.schoolId, name } });
    return reply.code(201).send(toRoomDto(room));
  });

  app.delete('/api/rooms/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as { id: string };
    const result = await prisma.room.deleteMany({ where: { id, schoolId: me.schoolId } });
    if (result.count === 0) throw notFound('Lokaal niet gevonden');
    return reply.code(204).send();
  });
}

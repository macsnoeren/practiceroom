import type { FastifyInstance } from 'fastify';
import {
  CreateComposedSourceSchema,
  PIP_SIZES,
  UpdateComposedSourceSchema,
  type PipSize,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toComposedSourceDto } from '../lib/dto.js';

interface SourceParams {
  id: string;
}

type MemberInput = {
  deviceId: string;
  role: 'main' | 'pip';
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  size?: PipSize;
};

/**
 * Validates that every member device belongs to the given room, then maps the
 * input members to the rows stored for a source. A pip without a position is
 * rejected; its size preset is resolved to a width fraction.
 */
async function buildMemberRows(
  schoolId: string,
  roomId: string,
  members: MemberInput[],
): Promise<{ deviceId: string; role: string; position: string | null; scale: number | null; order: number }[]> {
  const room = await prisma.room.findFirst({ where: { id: roomId, schoolId } });
  if (!room) throw notFound('Lokaal niet gevonden');

  const deviceIds = members.map((m) => m.deviceId);
  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, schoolId },
    select: { id: true, roomId: true },
  });
  const byId = new Map(devices.map((d) => [d.id, d]));
  return members.map((m, order) => {
    const device = byId.get(m.deviceId);
    if (!device) throw badRequest('Onbekende camera in de bron');
    if (device.roomId !== roomId) throw badRequest('Camera hoort niet bij dit lokaal');
    if (m.role === 'pip' && !m.position) throw badRequest('Een inzet heeft een hoek nodig');
    return {
      deviceId: m.deviceId,
      role: m.role,
      position: m.role === 'pip' ? (m.position ?? null) : null,
      scale: m.role === 'pip' ? PIP_SIZES[m.size ?? 'medium'] : null,
      order,
    };
  });
}

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sources', async (request) => {
    const me = requireAuth(request);
    const { roomId } = request.query as { roomId?: string };
    const sources = await prisma.composedSource.findMany({
      where: { schoolId: me.schoolId, ...(roomId ? { roomId } : {}) },
      orderBy: { name: 'asc' },
      include: { members: true },
    });
    return sources.map(toComposedSourceDto);
  });

  app.post('/api/sources', { preHandler: requireRole('admin', 'teacher') }, async (request, reply) => {
    const me = requireAuth(request);
    const input = CreateComposedSourceSchema.parse(request.body);
    const memberRows = await buildMemberRows(me.schoolId, input.roomId, input.members);

    const source = await prisma.composedSource.create({
      data: {
        schoolId: me.schoolId,
        roomId: input.roomId,
        name: input.name,
        members: { create: memberRows },
      },
      include: { members: true },
    });
    return reply.code(201).send(toComposedSourceDto(source));
  });

  app.patch('/api/sources/:id', { preHandler: requireRole('admin', 'teacher') }, async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as SourceParams;
    const input = UpdateComposedSourceSchema.parse(request.body);

    const existing = await prisma.composedSource.findFirst({
      where: { id, schoolId: me.schoolId },
    });
    if (!existing) throw notFound('Bron niet gevonden');
    const memberRows = await buildMemberRows(me.schoolId, input.roomId, input.members);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.composedSourceMember.deleteMany({ where: { sourceId: id } });
      return tx.composedSource.update({
        where: { id },
        data: {
          name: input.name,
          roomId: input.roomId,
          members: { create: memberRows },
        },
        include: { members: true },
      });
    });
    return toComposedSourceDto(updated);
  });

  app.delete('/api/sources/:id', { preHandler: requireRole('admin', 'teacher') }, async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as SourceParams;
    const result = await prisma.composedSource.deleteMany({ where: { id, schoolId: me.schoolId } });
    if (result.count === 0) throw notFound('Bron niet gevonden');
    return reply.code(204).send();
  });
}

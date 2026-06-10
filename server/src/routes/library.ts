import type { FastifyInstance } from 'fastify';
import {
  CreateLibraryItemSchema,
  SaveFromLessonSchema,
  UpdateLibraryItemSchema,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { AuthUser } from '../auth/plugin.js';
import { canViewLesson } from '../lib/lesson-access.js';
import { toLibraryItemDto } from '../lib/dto.js';
import { PLAYBACK_TTL_MS, libraryResource, signPlayback, verifyPlayback } from '../lib/signing.js';
import {
  appendLibraryChunk,
  copyCompositeToLibrary,
  libraryPath,
  librarySize,
  removeFile,
} from '../lib/storage.js';
import { streamFile } from '../lib/stream.js';

interface IdParam {
  id: string;
}

/** Owner, or anyone who may view a lesson the item is attached to. */
async function canAccessLibraryItem(
  me: AuthUser,
  item: { id: string; schoolId: string; ownerId: string },
): Promise<boolean> {
  if (item.schoolId !== me.schoolId) return false;
  if (item.ownerId === me.id) return true;
  const materials = await prisma.material.findMany({
    where: { libraryItemId: item.id },
    include: { lesson: true },
  });
  return materials.some((m) => canViewLesson(me, m.lesson));
}

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  // List the caller's own library.
  app.get('/api/library', { preHandler: requireRole('admin', 'teacher') }, async (request) => {
    const me = requireAuth(request);
    const items = await prisma.libraryItem.findMany({
      where: { ownerId: me.id, schoolId: me.schoolId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(toLibraryItemDto);
  });

  // Create a library item: an external link (ready immediately) or a file
  // placeholder that the client then uploads in chunks.
  app.post(
    '/api/library',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const input = CreateLibraryItemSchema.parse(request.body);

      const item = await prisma.libraryItem.create({
        data: {
          schoolId: me.schoolId,
          ownerId: me.id,
          title: input.title,
          description: input.description ?? null,
          kind: input.kind,
          url: input.kind === 'link' ? (input.url ?? null) : null,
          status: input.kind === 'file' ? 'uploading' : 'ready',
        },
      });
      return reply.code(201).send(toLibraryItemDto(item));
    },
  );

  // Save a lesson's combined video into the library (copies the file).
  app.post(
    '/api/library/from-lesson/:lessonId',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { lessonId } = request.params as { lessonId: string };
      const input = SaveFromLessonSchema.parse(request.body);

      const lesson = await prisma.lesson.findFirst({
        where: { id: lessonId, schoolId: me.schoolId },
        include: { composite: true },
      });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canViewLesson(me, lesson)) throw forbidden();
      if (lesson.composite?.status !== 'completed') {
        throw badRequest('De lesvideo is nog niet klaar');
      }

      const item = await prisma.libraryItem.create({
        data: {
          schoolId: me.schoolId,
          ownerId: me.id,
          title: input.title,
          description: input.description ?? null,
          kind: 'file',
          mimeType: 'video/mp4',
          status: 'ready',
        },
      });
      const size = await copyCompositeToLibrary(lessonId, item.id);
      const updated = await prisma.libraryItem.update({
        where: { id: item.id },
        data: { sizeBytes: size },
      });
      return reply.code(201).send(toLibraryItemDto(updated));
    },
  );

  // Append the next ordered chunk of an uploading file (idempotent on retries).
  app.post('/api/library/:id/chunks', async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const index = Number((request.query as { index?: string }).index);
    if (!Number.isInteger(index) || index < 0) throw badRequest('Ongeldige chunk-index');

    const item = await prisma.libraryItem.findFirst({ where: { id, ownerId: me.id } });
    if (!item) throw notFound('Item niet gevonden');
    if (item.kind !== 'file' || item.status !== 'uploading') {
      throw conflict('Dit item neemt geen upload aan');
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Lege chunk');

    if (index < item.receivedChunks) return { received: item.receivedChunks };
    if (index > item.receivedChunks) {
      return reply
        .code(409)
        .send({ error: 'Chunk niet in volgorde', expected: item.receivedChunks });
    }

    await appendLibraryChunk(id, body);
    const updated = await prisma.libraryItem.update({
      where: { id },
      data: { receivedChunks: { increment: 1 }, sizeBytes: { increment: body.length } },
    });
    return { received: updated.receivedChunks };
  });

  app.post('/api/library/:id/complete', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const mimeType = (request.query as { mimeType?: string }).mimeType;

    const item = await prisma.libraryItem.findFirst({ where: { id, ownerId: me.id } });
    if (!item) throw notFound('Item niet gevonden');

    const updated = await prisma.libraryItem.update({
      where: { id },
      data: {
        status: 'ready',
        sizeBytes: await librarySize(id),
        mimeType: mimeType ?? item.mimeType ?? 'video/webm',
      },
    });
    return toLibraryItemDto(updated);
  });

  app.patch(
    '/api/library/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const input = UpdateLibraryItemSchema.parse(request.body);

      const item = await prisma.libraryItem.findFirst({ where: { id, ownerId: me.id } });
      if (!item) throw notFound('Item niet gevonden');

      const updated = await prisma.libraryItem.update({
        where: { id },
        data: { title: input.title, description: input.description },
      });
      return toLibraryItemDto(updated);
    },
  );

  app.delete(
    '/api/library/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const result = await prisma.libraryItem.deleteMany({ where: { id, ownerId: me.id } });
      if (result.count === 0) throw notFound('Item niet gevonden');
      await removeFile(libraryPath(id));
      return reply.code(204).send();
    },
  );

  // Signed playback for a library file (owner or a participant of a lesson it
  // is attached to). Mirrors the recording/composite playback model.
  app.get('/api/library/:id/playback-url', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const item = await prisma.libraryItem.findUnique({ where: { id } });
    if (!item) throw notFound('Item niet gevonden');
    if (item.kind !== 'file' || item.status !== 'ready')
      throw badRequest('Geen afspeelbaar bestand');
    if (!(await canAccessLibraryItem(me, item))) throw forbidden();

    const expires = Date.now() + PLAYBACK_TTL_MS;
    const signature = signPlayback(libraryResource(id), expires);
    return {
      url: `/api/library/${id}/stream?expires=${expires}&sig=${signature}`,
      expiresAt: new Date(expires).toISOString(),
    };
  });

  app.get('/api/library/:id/stream', async (request, reply) => {
    const { id } = request.params as IdParam;
    const query = request.query as { expires?: string; sig?: string };
    if (!verifyPlayback(libraryResource(id), Number(query.expires), String(query.sig ?? ''))) {
      throw forbidden('Link is ongeldig of verlopen');
    }
    const me = requireAuth(request);
    const item = await prisma.libraryItem.findUnique({ where: { id } });
    if (!item) throw notFound('Item niet gevonden');
    if (!(await canAccessLibraryItem(me, item))) throw forbidden();

    return streamFile(request, reply, libraryPath(id), item.mimeType ?? 'video/mp4');
  });
}

import type { FastifyInstance } from 'fastify';
import { authenticateDevice } from '../auth/device.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { canManageLesson, canViewLesson } from '../lib/lesson-access.js';
import {
  PLAYBACK_TTL_MS,
  recordingResource,
  signPlayback,
  verifyPlayback,
} from '../lib/signing.js';
import {
  appendChunk,
  compositePath,
  recordingPath,
  recordingSize,
  removeFile,
} from '../lib/storage.js';
import { streamFile } from '../lib/stream.js';
import { toRecordingDto } from '../lib/dto.js';

interface RecordingParam {
  id: string;
}

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  // A device fetches its upload progress so it can resume after an interruption.
  app.get('/api/recordings/:id', async (request) => {
    const device = await authenticateDevice(request);
    const { id } = request.params as RecordingParam;
    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording || recording.deviceId !== device.id) throw notFound('Opname niet gevonden');
    return { id: recording.id, status: recording.status, receivedChunks: recording.receivedChunks };
  });

  // Append the next ordered chunk. Idempotent on retries; a gap returns 409
  // with the expected index so the client knows where to resume.
  app.post('/api/recordings/:id/chunks', async (request, reply) => {
    const device = await authenticateDevice(request);
    const { id } = request.params as RecordingParam;
    const index = Number((request.query as { index?: string }).index);
    if (!Number.isInteger(index) || index < 0) throw badRequest('Ongeldige chunk-index');

    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording || recording.deviceId !== device.id) throw notFound('Opname niet gevonden');
    if (recording.status !== 'recording') throw conflict('Opname is al afgesloten');

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Lege chunk');

    if (index < recording.receivedChunks) {
      // Already stored (a retry after a lost response). No-op, stay idempotent.
      return { received: recording.receivedChunks };
    }
    if (index > recording.receivedChunks) {
      return reply
        .code(409)
        .send({ error: 'Chunk niet in volgorde', expected: recording.receivedChunks });
    }

    await appendChunk(id, body);
    const updated = await prisma.recording.update({
      where: { id },
      data: { receivedChunks: { increment: 1 }, sizeBytes: { increment: body.length } },
    });
    return { received: updated.receivedChunks };
  });

  app.post('/api/recordings/:id/complete', async (request) => {
    const device = await authenticateDevice(request);
    const { id } = request.params as RecordingParam;
    const query = request.query as { mimeType?: string; hasVideo?: string; hasAudio?: string };

    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording || recording.deviceId !== device.id) throw notFound('Opname niet gevonden');

    // The device reports what it actually captured (camera + mic, audio only, or
    // video without sound) so the composite worker can stitch it correctly.
    const hasVideo = query.hasVideo === undefined ? recording.hasVideo : query.hasVideo !== 'false';
    const hasAudio = query.hasAudio === undefined ? recording.hasAudio : query.hasAudio !== 'false';

    const size = await recordingSize(id);
    const completed = await prisma.recording.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        sizeBytes: size,
        mimeType: query.mimeType ?? recording.mimeType,
        hasVideo,
        hasAudio,
      },
    });

    // Completing a single segment does not end the lesson; the teacher does
    // that explicitly via "finish", which also queues the composite worker.
    return toRecordingDto(completed);
  });

  // Staff deletes a recorded segment. If the lesson already has a combined
  // video, it is rebuilt from the remaining segments (or removed if none left).
  app.delete(
    '/api/recordings/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as RecordingParam;
      const recording = await prisma.recording.findUnique({
        where: { id },
        include: { lesson: { include: { composite: true } } },
      });
      if (!recording || recording.lesson.schoolId !== me.schoolId) {
        throw notFound('Opname niet gevonden');
      }
      if (!canManageLesson(me, recording.lesson)) throw forbidden();
      if (recording.status === 'recording') throw badRequest('Stop de opname eerst');

      await removeFile(recordingPath(id));
      await prisma.recording.delete({ where: { id } });

      const composite = recording.lesson.composite;
      if (composite) {
        const remaining = await prisma.recording.count({
          where: { lessonId: recording.lessonId, status: 'completed' },
        });
        if (remaining > 0) {
          // Rebuild the combined video without the deleted segment.
          await prisma.compositeVideo.update({
            where: { id: composite.id },
            data: { status: 'queued', error: null },
          });
        } else {
          await removeFile(compositePath(recording.lessonId));
          await prisma.compositeVideo.delete({ where: { id: composite.id } });
          await prisma.lesson.update({
            where: { id: recording.lessonId },
            data: { status: 'recorded' },
          });
        }
      }
      return reply.code(204).send();
    },
  );

  /* ---- Playback (staff/student, cookie session) ---------------------------- */

  // Issue a short-lived signed URL to stream a completed recording. Only a
  // participant of the lesson (admin/teacher/student) may obtain one.
  app.get('/api/recordings/:id/playback-url', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as RecordingParam;

    const recording = await prisma.recording.findUnique({
      where: { id },
      include: { lesson: true },
    });
    if (!recording || recording.lesson.schoolId !== me.schoolId)
      throw notFound('Opname niet gevonden');
    if (!canViewLesson(me, recording.lesson)) throw forbidden();
    if (recording.status !== 'completed') throw badRequest('Opname is nog niet klaar');

    const expires = Date.now() + PLAYBACK_TTL_MS;
    const signature = signPlayback(recordingResource(id), expires);
    return {
      url: `/api/recordings/${id}/stream?expires=${expires}&sig=${signature}`,
      expiresAt: new Date(expires).toISOString(),
    };
  });

  // Stream the video. Requires a valid (unexpired) signature AND that the
  // logged-in caller may view the lesson — so a copied link is useless to a
  // non-participant and stops working after it expires. Supports range requests
  // for seeking.
  app.get('/api/recordings/:id/stream', async (request, reply) => {
    const { id } = request.params as RecordingParam;
    const query = request.query as { expires?: string; sig?: string };
    if (!verifyPlayback(recordingResource(id), Number(query.expires), String(query.sig ?? ''))) {
      throw forbidden('Link is ongeldig of verlopen');
    }

    const me = requireAuth(request);
    const recording = await prisma.recording.findUnique({
      where: { id },
      include: { lesson: true },
    });
    if (!recording || recording.lesson.schoolId !== me.schoolId)
      throw notFound('Opname niet gevonden');
    if (!canViewLesson(me, recording.lesson)) throw forbidden();

    return streamFile(request, reply, recordingPath(id), recording.mimeType ?? 'video/webm');
  });
}

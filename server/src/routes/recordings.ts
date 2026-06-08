import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { authenticateDevice } from '../auth/device.js';
import { requireAuth } from '../auth/plugin.js';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { canViewLesson } from '../lib/lesson-access.js';
import { signPlayback, verifyPlayback } from '../lib/signing.js';
import { appendChunk, recordingPath, recordingSize } from '../lib/storage.js';
import { toRecordingDto } from '../lib/dto.js';

interface RecordingParam {
  id: string;
}

const PLAYBACK_TTL_MS = 60 * 60 * 1000; // 1 hour

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
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
    const mimeType = (request.query as { mimeType?: string }).mimeType;

    const recording = await prisma.recording.findUnique({ where: { id } });
    if (!recording || recording.deviceId !== device.id) throw notFound('Opname niet gevonden');

    const size = await recordingSize(id);
    const completed = await prisma.recording.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        sizeBytes: size,
        mimeType: mimeType ?? recording.mimeType,
      },
    });

    // When every recording for the lesson is done, the lesson is "recorded".
    const remaining = await prisma.recording.count({
      where: { lessonId: recording.lessonId, status: 'recording' },
    });
    if (remaining === 0) {
      await prisma.lesson.update({
        where: { id: recording.lessonId },
        data: { status: 'recorded' },
      });
    }
    return toRecordingDto(completed);
  });

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
    const signature = signPlayback(id, expires);
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
    if (!verifyPlayback(id, Number(query.expires), String(query.sig ?? ''))) {
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

    const path = recordingPath(id);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw notFound('Opnamebestand niet gevonden');
    }

    const contentType = recording.mimeType ?? 'video/webm';
    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, size);
      if (!range) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      reply
        .code(206)
        .header('Content-Type', contentType)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1);
      return reply.send(createReadStream(path, { start: range.start, end: range.end }));
    }

    reply
      .header('Content-Type', contentType)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', size);
    return reply.send(createReadStream(path));
  });
}

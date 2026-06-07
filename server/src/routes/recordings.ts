import type { FastifyInstance } from 'fastify';
import { authenticateDevice } from '../auth/device.js';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { appendChunk, recordingSize } from '../lib/storage.js';
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
}

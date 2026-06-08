import type { FastifyInstance } from 'fastify';
import {
  CreateLessonSchema,
  CreateMaterialSchema,
  SetLessonDevicesSchema,
  SOCKET_EVENTS,
  UpdateLessonSchema,
  type Role,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { canManageLesson, canViewLesson } from '../lib/lesson-access.js';
import {
  lessonDetailInclude,
  lessonListInclude,
  toLessonDetailDto,
  toLessonDto,
  toMaterialDto,
  toRecordingDto,
} from '../lib/dto.js';

interface IdParam {
  id: string;
}
interface MaterialParams {
  id: string;
  materialId: string;
}

async function assertUserInSchool(id: string, schoolId: string, role: Role): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id, schoolId, role } });
  if (!user) throw badRequest(`Geen ${role} gevonden in deze school`);
}

export async function lessonRoutes(app: FastifyInstance): Promise<void> {
  // List lessons relevant to the caller (own school; scoped by role).
  app.get('/api/lessons', async (request) => {
    const me = requireAuth(request);
    const where = {
      schoolId: me.schoolId,
      ...(me.role === 'teacher' ? { teacherId: me.id } : {}),
      ...(me.role === 'student' ? { studentId: me.id } : {}),
    };
    const lessons = await prisma.lesson.findMany({
      where,
      include: lessonListInclude,
      orderBy: { startsAt: 'asc' },
    });
    return lessons.map(toLessonDto);
  });

  app.get('/api/lessons/:id', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const lesson = await prisma.lesson.findFirst({
      where: { id, schoolId: me.schoolId },
      include: lessonDetailInclude,
    });
    if (!lesson) throw notFound('Les niet gevonden');
    if (!canViewLesson(me, lesson)) throw forbidden();
    return toLessonDetailDto(lesson);
  });

  app.post(
    '/api/lessons',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const input = CreateLessonSchema.parse(request.body);

      // A teacher always teaches their own lessons; an admin must pick a teacher.
      const teacherId = me.role === 'teacher' ? me.id : input.teacherId;
      if (!teacherId) throw badRequest('Kies een leraar');
      await assertUserInSchool(teacherId, me.schoolId, 'teacher');
      await assertUserInSchool(input.studentId, me.schoolId, 'student');

      const lesson = await prisma.lesson.create({
        data: {
          schoolId: me.schoolId,
          teacherId,
          studentId: input.studentId,
          title: input.title ?? null,
          startsAt: new Date(input.startsAt),
          durationMinutes: input.durationMinutes,
        },
        include: lessonListInclude,
      });
      return reply.code(201).send(toLessonDto(lesson));
    },
  );

  app.patch(
    '/api/lessons/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const input = UpdateLessonSchema.parse(request.body);

      const existing = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!existing) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, existing)) throw forbidden();
      if (input.studentId) await assertUserInSchool(input.studentId, me.schoolId, 'student');

      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          studentId: input.studentId,
          title: input.title === undefined ? undefined : input.title,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          durationMinutes: input.durationMinutes,
          status: input.status,
        },
        include: lessonListInclude,
      });
      return toLessonDto(lesson);
    },
  );

  app.delete(
    '/api/lessons/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const existing = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!existing) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, existing)) throw forbidden();
      await prisma.lesson.delete({ where: { id } });
      return reply.code(204).send();
    },
  );

  // Replace the set of cameras filming a lesson.
  app.put(
    '/api/lessons/:id/devices',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const { deviceIds } = SetLessonDevicesSchema.parse(request.body);
      const unique = [...new Set(deviceIds)];

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      if (unique.length > 0) {
        const count = await prisma.device.count({
          where: { id: { in: unique }, schoolId: me.schoolId },
        });
        if (count !== unique.length) throw badRequest('Onbekend apparaat geselecteerd');
      }

      await prisma.$transaction([
        prisma.lessonDevice.deleteMany({ where: { lessonId: id } }),
        ...(unique.length > 0
          ? [
              prisma.lessonDevice.createMany({
                data: unique.map((deviceId) => ({ lessonId: id, deviceId })),
              }),
            ]
          : []),
      ]);

      const updated = await prisma.lesson.findFirst({
        where: { id },
        include: lessonDetailInclude,
      });
      if (!updated) throw notFound('Les niet gevonden');
      return toLessonDetailDto(updated);
    },
  );

  app.post(
    '/api/lessons/:id/materials',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const input = CreateMaterialSchema.parse(request.body);

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const material = await prisma.material.create({
        data: {
          lessonId: id,
          title: input.title,
          url: input.url ?? null,
          note: input.note ?? null,
        },
      });
      return reply.code(201).send(toMaterialDto(material));
    },
  );

  app.delete(
    '/api/lessons/:id/materials/:materialId',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id, materialId } = request.params as MaterialParams;

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const result = await prisma.material.deleteMany({ where: { id: materialId, lessonId: id } });
      if (result.count === 0) throw notFound('Materiaal niet gevonden');
      return reply.code(204).send();
    },
  );

  // Start recording: create a Recording per ONLINE selected camera and command
  // those cameras over the websocket to begin.
  app.post(
    '/api/lessons/:id/recording/start',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;

      const lesson = await prisma.lesson.findFirst({
        where: { id, schoolId: me.schoolId },
        include: { devices: true },
      });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const onlineDeviceIds = lesson.devices
        .map((d) => d.deviceId)
        .filter((deviceId) => app.presence.isOnline(deviceId));
      if (onlineDeviceIds.length === 0) {
        throw badRequest('Geen geselecteerde camera is online');
      }

      // Don't double-start a device that is already recording for this lesson.
      const active = await prisma.recording.findMany({
        where: { lessonId: id, status: 'recording' },
        select: { deviceId: true },
      });
      const alreadyRecording = new Set(active.map((a) => a.deviceId));
      const toStart = onlineDeviceIds.filter((deviceId) => !alreadyRecording.has(deviceId));

      const recordings = await Promise.all(
        toStart.map((deviceId) =>
          prisma.recording.create({ data: { lessonId: id, deviceId, status: 'recording' } }),
        ),
      );
      await prisma.lesson.update({ where: { id }, data: { status: 'recording' } });

      for (const recording of recordings) {
        app.io
          .to(`device:${recording.deviceId}`)
          .emit(SOCKET_EVENTS.recordingStart, { recordingId: recording.id, lessonId: id });
      }
      return reply.code(201).send(recordings.map(toRecordingDto));
    },
  );

  // Stop recording: tell each actively recording camera to finish; the camera
  // flushes remaining chunks and calls /complete, which flips the lesson to
  // "recorded" once all cameras are done.
  app.post(
    '/api/lessons/:id/recording/stop',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const active = await prisma.recording.findMany({
        where: { lessonId: id, status: 'recording' },
      });
      for (const recording of active) {
        app.io
          .to(`device:${recording.deviceId}`)
          .emit(SOCKET_EVENTS.recordingStop, { recordingId: recording.id });
      }
      return { stopped: active.length };
    },
  );
}

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  AttachLibrarySchema,
  CreateLessonSchema,
  CreateMaterialSchema,
  CreateTagSchema,
  SetLessonDevicesSchema,
  SOCKET_EVENTS,
  StartRecordingInputSchema,
  UpdateLessonSchema,
  UpdateStudentNotesSchema,
  type Role,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { canManageLesson, canViewLesson } from '../lib/lesson-access.js';
import { holidayAt, isWithinHolidays } from '../lib/dates.js';
import {
  compositeResource,
  PLAYBACK_TTL_MS,
  signPlayback,
  verifyPlayback,
} from '../lib/signing.js';
import { compositePath } from '../lib/storage.js';
import { streamFile } from '../lib/stream.js';
import {
  lessonDetailInclude,
  lessonListInclude,
  toCompositeVideoDto,
  toLessonDetailDto,
  toLessonDto,
  toLessonTagDto,
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
interface TagParams {
  id: string;
  tagId: string;
}

// Any user at the location may be a lesson's student (a teacher can also take
// lessons). Pass a role only when it must be restricted.
async function assertUserInSchool(id: string, schoolId: string, role?: Role): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id, schoolId, ...(role ? { role } : {}) },
  });
  if (!user) throw badRequest('Onbekende gebruiker in deze school');
}

// A lesson's teacher may be a teacher OR an admin (admins teach too).
async function assertCanTeach(id: string, schoolId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id, schoolId, role: { in: ['teacher', 'admin'] } },
  });
  if (!user) throw badRequest('Geen geldige leraar gekozen');
}

async function assertRoomInSchool(id: string, schoolId: string): Promise<void> {
  const room = await prisma.room.findFirst({ where: { id, schoolId } });
  if (!room) throw badRequest('Onbekend lokaal');
}

export async function lessonRoutes(app: FastifyInstance): Promise<void> {
  // List lessons relevant to the caller (own school; scoped by role). Lessons
  // that fall within a school holiday are dropped from the schedule (they
  // "lapse"); removing the holiday brings them back.
  app.get('/api/lessons', async (request) => {
    const me = requireAuth(request);
    // `?student=me` returns the lessons where the caller is the student,
    // whatever their role — a teacher can also be enrolled as a student.
    const query = request.query as { student?: string; includeLapsed?: string };
    const asStudent = query.student === 'me';
    // By default lessons that fall in a holiday lapse and are hidden. With
    // `includeLapsed=true` they are returned with the holiday's name so a view
    // (e.g. the student's overview) can show them as cancelled.
    const includeLapsed = query.includeLapsed === 'true';
    const where = {
      schoolId: me.schoolId,
      ...(asStudent
        ? { studentId: me.id }
        : me.role === 'teacher'
          ? { teacherId: me.id }
          : me.role === 'student'
            ? { studentId: me.id }
            : {}),
    };
    const [lessons, holidays] = await Promise.all([
      prisma.lesson.findMany({ where, include: lessonListInclude, orderBy: { startsAt: 'asc' } }),
      prisma.holiday.findMany({
        where: { schoolId: me.schoolId },
        select: { name: true, startsOn: true, endsOn: true },
      }),
    ]);
    return lessons.flatMap((l) => {
      const holiday = holidayAt(l.startsAt, holidays);
      if (holiday && !includeLapsed) return [];
      return [toLessonDto(l, holiday?.name ?? null)];
    });
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

      // A teacher always teaches their own lessons; an admin picks a teacher
      // (which may be another teacher or the admin themselves).
      const teacherId = me.role === 'teacher' ? me.id : input.teacherId;
      if (!teacherId) throw badRequest('Kies een leraar');
      await assertCanTeach(teacherId, me.schoolId);
      await assertUserInSchool(input.studentId, me.schoolId);
      if (input.roomId) await assertRoomInSchool(input.roomId, me.schoolId);

      // Weekly recurrence: plan the same lesson for several weeks, skipping any
      // week that falls in a school holiday.
      const repeatWeeks = input.repeatWeeks ?? 1;
      const base = new Date(input.startsAt);
      const holidays = await prisma.holiday.findMany({
        where: { schoolId: me.schoolId },
        select: { startsOn: true, endsOn: true },
      });

      let dates: Date[];
      if (repeatWeeks <= 1) {
        if (isWithinHolidays(base, holidays)) throw badRequest('Deze datum valt in een vakantie');
        dates = [base];
      } else {
        dates = [];
        for (let week = 0; week < repeatWeeks; week++) {
          const occurrence = new Date(base.getTime() + week * 7 * 24 * 60 * 60 * 1000);
          if (!isWithinHolidays(occurrence, holidays)) dates.push(occurrence);
        }
      }
      const [firstDate, ...restDates] = dates;
      if (!firstDate) throw badRequest('Alle weken vallen in een vakantie');

      const seriesId = dates.length > 1 ? randomUUID() : null;
      const common = {
        schoolId: me.schoolId,
        teacherId,
        studentId: input.studentId,
        title: input.title ?? null,
        durationMinutes: input.durationMinutes,
        seriesId,
        roomId: input.roomId ?? null,
      };

      const first = await prisma.lesson.create({
        data: { ...common, startsAt: firstDate },
        include: lessonListInclude,
      });
      if (restDates.length > 0) {
        await prisma.lesson.createMany({
          data: restDates.map((startsAt) => ({ ...common, startsAt })),
        });
      }
      return reply.code(201).send(toLessonDto(first));
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
      if (input.studentId) await assertUserInSchool(input.studentId, me.schoolId);
      if (input.roomId) await assertRoomInSchool(input.roomId, me.schoolId);

      const lesson = await prisma.lesson.update({
        where: { id },
        data: {
          studentId: input.studentId,
          title: input.title === undefined ? undefined : input.title,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          durationMinutes: input.durationMinutes,
          status: input.status,
          notes: input.notes === undefined ? undefined : input.notes,
          roomId: input.roomId === undefined ? undefined : input.roomId,
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
      const deleteSeries = (request.query as { series?: string }).series === 'true';
      const existing = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!existing) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, existing)) throw forbidden();

      if (deleteSeries && existing.seriesId) {
        await prisma.lesson.deleteMany({
          where: {
            seriesId: existing.seriesId,
            schoolId: me.schoolId,
            ...(me.role === 'teacher' ? { teacherId: me.id } : {}),
          },
        });
      } else {
        await prisma.lesson.delete({ where: { id } });
      }
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

  // The lesson's student edits their own notes/questions (any role can be a
  // student). Staff can read these but not change them.
  app.patch('/api/lessons/:id/student-notes', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;
    const input = UpdateStudentNotesSchema.parse(request.body);

    const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
    if (!lesson) throw notFound('Les niet gevonden');
    if (lesson.studentId !== me.id) throw forbidden('Alleen de student van deze les');

    const updated = await prisma.lesson.update({
      where: { id },
      data: { studentNotes: input.studentNotes },
      include: lessonDetailInclude,
    });
    return toLessonDetailDto(updated);
  });

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

  // Attach a video from the teacher's own library to a lesson as extra material.
  app.post(
    '/api/lessons/:id/materials/from-library',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const { libraryItemId } = AttachLibrarySchema.parse(request.body);

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const item = await prisma.libraryItem.findFirst({
        where: { id: libraryItemId, ownerId: me.id, schoolId: me.schoolId },
      });
      if (!item) throw notFound('Bibliotheekitem niet gevonden');

      const material = await prisma.material.create({
        data: {
          lessonId: id,
          title: item.title,
          note: item.description,
          url: item.kind === 'link' ? item.url : null,
          libraryItemId: item.id,
        },
        include: { library: { select: { id: true, kind: true } } },
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

  // Place a timeline marker on a lesson (e.g. while it is being recorded).
  app.post(
    '/api/lessons/:id/tags',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const input = CreateTagSchema.parse(request.body);

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const tag = await prisma.lessonTag.create({ data: { lessonId: id, label: input.label } });
      return reply.code(201).send(toLessonTagDto(tag));
    },
  );

  app.delete(
    '/api/lessons/:id/tags/:tagId',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id, tagId } = request.params as TagParams;

      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      const result = await prisma.lessonTag.deleteMany({ where: { id: tagId, lessonId: id } });
      if (result.count === 0) throw notFound('Tag niet gevonden');
      return reply.code(204).send();
    },
  );

  // Tell every actively recording camera of a lesson to stop. Each camera
  // flushes its remaining chunks and completes its own segment.
  async function stopActiveSegments(lessonId: string): Promise<number> {
    const active = await prisma.recording.findMany({
      where: { lessonId, status: 'recording' },
    });
    for (const recording of active) {
      app.io
        .to(`device:${recording.deviceId}`)
        .emit(SOCKET_EVENTS.recordingStop, { recordingId: recording.id });
    }
    return active.length;
  }

  // Start recording on ONE camera. Only one camera records at a time, so any
  // currently-recording camera is stopped first. Each start is a new segment;
  // the final lesson video concatenates the segments in time order.
  app.post(
    '/api/lessons/:id/recording/start',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const { deviceId, sourceId } = StartRecordingInputSchema.parse(request.body);

      const lesson = await prisma.lesson.findFirst({
        where: { id, schoolId: me.schoolId },
        include: { devices: true },
      });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      // Once a lesson is finished it can no longer produce new recordings.
      if (lesson.status === 'recorded' || lesson.status === 'ready') {
        throw badRequest('Deze les is al afgerond');
      }

      // Resolve which cameras to start, with their layout within the segment. A
      // single camera has no layout; a composed source contributes its main
      // camera plus the pip insets that are currently online.
      type StartTarget = {
        deviceId: string;
        layoutRole: string | null;
        layoutPosition: string | null;
        layoutScale: number | null;
      };
      const targets: StartTarget[] = [];
      // A composed source can name its own audio-source device; otherwise we fall
      // back to the room's audio source below.
      let explicitAudioDeviceId: string | null = null;

      if (deviceId) {
        if (!lesson.devices.some((d) => d.deviceId === deviceId)) {
          throw badRequest('Deze camera hoort niet bij de les');
        }
        if (!app.presence.isOnline(deviceId)) {
          throw badRequest('Deze camera is niet online');
        }
        targets.push({ deviceId, layoutRole: null, layoutPosition: null, layoutScale: null });
      } else {
        const source = await prisma.composedSource.findFirst({
          where: { id: sourceId, schoolId: me.schoolId },
          include: { members: { orderBy: { order: 'asc' } } },
        });
        if (!source) throw notFound('Samengestelde bron niet gevonden');
        explicitAudioDeviceId = source.audioDeviceId;
        const main = source.members.find((m) => m.role === 'main');
        if (!main) throw badRequest('De bron heeft geen hoofdcamera');
        if (!app.presence.isOnline(main.deviceId)) {
          throw badRequest('De hoofdcamera van de bron is niet online');
        }
        targets.push({
          deviceId: main.deviceId,
          layoutRole: 'main',
          layoutPosition: null,
          layoutScale: null,
        });
        for (const pip of source.members.filter((m) => m.role === 'pip')) {
          // Skip offline insets — the source still records without them.
          if (!app.presence.isOnline(pip.deviceId)) continue;
          targets.push({
            deviceId: pip.deviceId,
            layoutRole: 'pip',
            layoutPosition: pip.position,
            layoutScale: pip.scale,
          });
        }
      }

      // Switching sources: stop whatever is recording now.
      await stopActiveSegments(id);

      // Everything started together shares a group id so the worker stitches it
      // into one segment (camera(s) overlaid, the audio source laid underneath).
      const segmentGroupId = randomUUID();
      await prisma.lesson.update({ where: { id }, data: { status: 'recording' } });

      // The audio source whose sound is laid under the segment: the composed
      // source's own choice when set, otherwise the room's audio source. When it
      // is also a video member (one device = camera + mic), that single recording
      // doubles as the audio track — a device cannot record twice.
      const audioSource = explicitAudioDeviceId
        ? await prisma.device.findFirst({
            where: { id: explicitAudioDeviceId, schoolId: me.schoolId },
          })
        : lesson.roomId
          ? await prisma.device.findFirst({
              where: { schoolId: me.schoolId, roomId: lesson.roomId, isAudioSource: true },
            })
          : null;
      const audioSourceIsMember = !!audioSource && targets.some((t) => t.deviceId === audioSource.id);

      const lessonDeviceIds = new Set(lesson.devices.map((d) => d.deviceId));
      // Every device + recording that takes part in this segment (for sync-tone).
      const groupDeviceIds: string[] = [];
      const groupRecordingIds: string[] = [];
      let firstRecordingId: string | null = null;
      for (const target of targets) {
        if (!lessonDeviceIds.has(target.deviceId)) {
          await prisma.lessonDevice.create({ data: { lessonId: id, deviceId: target.deviceId } });
          lessonDeviceIds.add(target.deviceId);
        }
        // A composed-source member that is the audio source provides the audio
        // track from its own (single) recording. A lone single camera keeps its
        // own audio naturally, so it is never flagged here.
        const isAudioTrack =
          target.layoutRole !== null && !!audioSource && target.deviceId === audioSource.id;
        const created = await prisma.recording.create({
          data: {
            lessonId: id,
            deviceId: target.deviceId,
            status: 'recording',
            segmentGroupId,
            layoutRole: target.layoutRole,
            layoutPosition: target.layoutPosition,
            layoutScale: target.layoutScale,
            isAudioTrack,
          },
        });
        if (firstRecordingId === null) firstRecordingId = created.id;
        groupDeviceIds.push(target.deviceId);
        groupRecordingIds.push(created.id);
        app.io
          .to(`device:${target.deviceId}`)
          .emit(SOCKET_EVENTS.recordingStart, { recordingId: created.id, lessonId: id });
      }

      // When the audio source is NOT already among the cameras, record it in
      // parallel as a dedicated audio track for this segment.
      if (audioSource && app.presence.isOnline(audioSource.id) && !audioSourceIsMember) {
        if (!lessonDeviceIds.has(audioSource.id)) {
          await prisma.lessonDevice.create({ data: { lessonId: id, deviceId: audioSource.id } });
        }
        const audioRecording = await prisma.recording.create({
          data: {
            lessonId: id,
            deviceId: audioSource.id,
            status: 'recording',
            segmentGroupId,
            isAudioTrack: true,
          },
        });
        groupDeviceIds.push(audioSource.id);
        groupRecordingIds.push(audioRecording.id);
        app.io
          .to(`device:${audioSource.id}`)
          .emit(SOCKET_EVENTS.recordingStart, { recordingId: audioRecording.id, lessonId: id });
      }

      // Multiple devices in one segment need exact alignment. If the room has an
      // online speaker, mark the segment for tone-based sync and arm the speaker
      // to play the start/sync tone once every device is recording.
      if (groupDeviceIds.length >= 2 && lesson.roomId) {
        const speaker = await prisma.device.findFirst({
          where: { schoolId: me.schoolId, roomId: lesson.roomId, kind: 'speaker' },
        });
        if (speaker && app.presence.isOnline(speaker.id)) {
          await prisma.recording.updateMany({
            where: { id: { in: groupRecordingIds } },
            data: { syncTone: true },
          });
          app.syncCoordinator.arm(segmentGroupId, {
            deviceIds: groupDeviceIds,
            speakerId: speaker.id,
            schoolId: me.schoolId,
            lessonId: id,
          });
        }
      }

      const main = await prisma.recording.findUniqueOrThrow({ where: { id: firstRecordingId! } });
      return reply.code(201).send(toRecordingDto(main));
    },
  );

  // Stop the current segment (the lesson stays in its recording session).
  app.post(
    '/api/lessons/:id/recording/stop',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      return { stopped: await stopActiveSegments(id) };
    },
  );

  // Finish the lesson: stop any active segment, mark it recorded and queue the
  // worker that concatenates the segments into one lesson video.
  app.post(
    '/api/lessons/:id/recording/finish',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as IdParam;
      const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!lesson) throw notFound('Les niet gevonden');
      if (!canManageLesson(me, lesson)) throw forbidden();

      await stopActiveSegments(id);
      await prisma.lesson.update({ where: { id }, data: { status: 'recorded' } });
      // Queue (or re-queue) the composite job for this lesson.
      const composite = await prisma.compositeVideo.upsert({
        where: { lessonId: id },
        create: { lessonId: id, status: 'queued' },
        update: { status: 'queued', error: null, completedAt: null },
      });
      return toCompositeVideoDto(composite);
    },
  );

  /* ---- Composite (combined lesson video) playback -------------------------- */

  app.get('/api/lessons/:id/composite/playback-url', async (request) => {
    const me = requireAuth(request);
    const { id } = request.params as IdParam;

    const lesson = await prisma.lesson.findFirst({
      where: { id, schoolId: me.schoolId },
      include: { composite: true },
    });
    if (!lesson) throw notFound('Les niet gevonden');
    if (!canViewLesson(me, lesson)) throw forbidden();
    if (lesson.composite?.status !== 'completed') throw badRequest('De lesvideo is nog niet klaar');

    const expires = Date.now() + PLAYBACK_TTL_MS;
    const signature = signPlayback(compositeResource(id), expires);
    return {
      url: `/api/lessons/${id}/composite/stream?expires=${expires}&sig=${signature}`,
      expiresAt: new Date(expires).toISOString(),
    };
  });

  app.get('/api/lessons/:id/composite/stream', async (request, reply) => {
    const { id } = request.params as IdParam;
    const query = request.query as { expires?: string; sig?: string };
    if (!verifyPlayback(compositeResource(id), Number(query.expires), String(query.sig ?? ''))) {
      throw forbidden('Link is ongeldig of verlopen');
    }

    const me = requireAuth(request);
    const lesson = await prisma.lesson.findFirst({ where: { id, schoolId: me.schoolId } });
    if (!lesson) throw notFound('Les niet gevonden');
    if (!canViewLesson(me, lesson)) throw forbidden();

    return streamFile(request, reply, compositePath(id), 'video/mp4');
  });
}

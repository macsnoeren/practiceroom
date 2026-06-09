import type {
  CompositeVideo,
  Device,
  Holiday,
  Material,
  Prisma,
  Recording,
  Room,
  School,
  User,
} from '@prisma/client';
import type {
  CompositeStatus,
  CompositeVideoDto,
  DeviceDto,
  HolidayDto,
  LessonDetailDto,
  LessonDto,
  LessonStatus,
  MaterialDto,
  RecordingDto,
  RecordingStatus,
  Role,
  RoomDto,
  SchoolDto,
  UserDto,
} from '@practiceroom/shared';

/** Format a Date as a date-only string (YYYY-MM-DD, UTC). */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Map a database user to the client-facing DTO. Never leaks the password hash. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    schoolId: user.schoolId,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    emailVerified: user.emailVerified,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSchoolDto(school: School): SchoolDto {
  return {
    id: school.id,
    name: school.name,
    createdAt: school.createdAt.toISOString(),
  };
}

/** Map a device to its dashboard DTO. Never leaks the token hash. */
export function toDeviceDto(device: Device): DeviceDto {
  return {
    id: device.id,
    schoolId: device.schoolId,
    name: device.name,
    paired: device.tokenHash !== null,
    pairedAt: device.pairedAt?.toISOString() ?? null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  };
}

/* ---- Lessons ------------------------------------------------------------- */

const personSelect = { select: { id: true, name: true } } as const;

const roomSelect = { select: { id: true, name: true } } as const;

/** Prisma include shared by the lesson list endpoints. */
export const lessonListInclude = {
  teacher: personSelect,
  student: personSelect,
  room: roomSelect,
} satisfies Prisma.LessonInclude;

/** Prisma include for a full lesson (with cameras, material and recordings). */
export const lessonDetailInclude = {
  teacher: personSelect,
  student: personSelect,
  room: roomSelect,
  devices: { include: { device: { select: { id: true, name: true } } } },
  materials: { orderBy: { createdAt: 'asc' } },
  recordings: { orderBy: { startedAt: 'asc' } },
  composite: true,
} satisfies Prisma.LessonInclude;

type LessonListRow = Prisma.LessonGetPayload<{ include: typeof lessonListInclude }>;
type LessonDetailRow = Prisma.LessonGetPayload<{ include: typeof lessonDetailInclude }>;

export function toMaterialDto(material: Material): MaterialDto {
  return {
    id: material.id,
    lessonId: material.lessonId,
    title: material.title,
    url: material.url,
    note: material.note,
    createdAt: material.createdAt.toISOString(),
  };
}

export function toLessonDto(lesson: LessonListRow): LessonDto {
  return {
    id: lesson.id,
    schoolId: lesson.schoolId,
    teacher: lesson.teacher,
    student: lesson.student,
    title: lesson.title,
    startsAt: lesson.startsAt.toISOString(),
    durationMinutes: lesson.durationMinutes,
    status: lesson.status as LessonStatus,
    seriesId: lesson.seriesId,
    notes: lesson.notes,
    room: lesson.room ? { id: lesson.room.id, name: lesson.room.name } : null,
    createdAt: lesson.createdAt.toISOString(),
  };
}

export function toRoomDto(room: Room): RoomDto {
  return {
    id: room.id,
    schoolId: room.schoolId,
    name: room.name,
    createdAt: room.createdAt.toISOString(),
  };
}

export function toHolidayDto(holiday: Holiday): HolidayDto {
  return {
    id: holiday.id,
    schoolId: holiday.schoolId,
    name: holiday.name,
    startsOn: toDateOnly(holiday.startsOn),
    endsOn: toDateOnly(holiday.endsOn),
    createdAt: holiday.createdAt.toISOString(),
  };
}

export function toRecordingDto(recording: Recording): RecordingDto {
  return {
    id: recording.id,
    lessonId: recording.lessonId,
    deviceId: recording.deviceId,
    status: recording.status as RecordingStatus,
    sizeBytes: recording.sizeBytes,
    startedAt: recording.startedAt.toISOString(),
    completedAt: recording.completedAt?.toISOString() ?? null,
  };
}

export function toCompositeVideoDto(composite: CompositeVideo): CompositeVideoDto {
  return {
    status: composite.status as CompositeStatus,
    sizeBytes: composite.sizeBytes,
    error: composite.error,
  };
}

export function toLessonDetailDto(lesson: LessonDetailRow): LessonDetailDto {
  return {
    ...toLessonDto(lesson),
    devices: lesson.devices.map((d) => ({ id: d.device.id, name: d.device.name })),
    materials: lesson.materials.map(toMaterialDto),
    recordings: lesson.recordings.map(toRecordingDto),
    composite: lesson.composite ? toCompositeVideoDto(lesson.composite) : null,
  };
}

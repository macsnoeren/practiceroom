import type {
  AuditLog,
  ComposedSource,
  ComposedSourceMember,
  CompositeVideo,
  Device,
  Holiday,
  LessonTag,
  LibraryItem,
  Material,
  Prisma,
  Recording,
  Room,
  School,
  User,
} from '@prisma/client';
import type {
  AuditLogDto,
  ComposedSourceDto,
  ComposedSourceMemberDto,
  CompositeStatus,
  CompositeVideoDto,
  DeviceDto,
  HolidayDto,
  LessonDetailDto,
  LessonDto,
  LessonStatus,
  LessonTagDto,
  GlobalUserDto,
  LibraryItemDto,
  LibraryKind,
  LibraryStatus,
  MaterialDto,
  RecordingDto,
  RecordingStatus,
  RoomDto,
  SchoolDto,
  SchoolSettingsDto,
  SchoolSummaryDto,
  UserDto,
  UserRole,
} from '@practiceroom/shared';

/** Format a Date as a date-only string (YYYY-MM-DD, UTC). */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Map a database user to the client-facing DTO. Never leaks the password hash.
 * `activeSchoolId` is only meaningful for a superadmin (the school they entered). */
export function toUserDto(user: User, activeSchoolId: string | null = null): UserDto {
  return {
    id: user.id,
    schoolId: user.schoolId,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    emailVerified: user.emailVerified,
    totpEnabled: user.totpEnabled,
    activeSchoolId,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSchoolSummaryDto(
  school: School & { _count?: { users: number; lessons: number } },
): SchoolSummaryDto {
  return {
    id: school.id,
    name: school.name,
    userCount: school._count?.users ?? 0,
    lessonCount: school._count?.lessons ?? 0,
    createdAt: school.createdAt.toISOString(),
  };
}

export function toGlobalUserDto(user: User & { school?: { name: string } | null }): GlobalUserDto {
  return { ...toUserDto(user), schoolName: user.school?.name ?? null };
}

/** Map an audit-log row to its DTO, with the school name resolved by the caller
 * (audit rows store only the id so they survive a school's deletion). */
export function toAuditLogDto(log: AuditLog, schoolName: string | null = null): AuditLogDto {
  return {
    id: log.id,
    action: log.action,
    schoolId: log.schoolId,
    schoolName,
    userId: log.userId,
    email: log.email,
    ip: log.ip,
    detail: log.detail,
    createdAt: log.createdAt.toISOString(),
  };
}

export function toSchoolDto(school: School): SchoolDto {
  return {
    id: school.id,
    name: school.name,
    createdAt: school.createdAt.toISOString(),
  };
}

export function toSchoolSettingsDto(school: School): SchoolSettingsDto {
  return {
    overlayText: school.overlayText,
    intro: school.introMimeType
      ? { mimeType: school.introMimeType, sizeBytes: school.introSizeBytes }
      : null,
    outro: school.outroMimeType
      ? { mimeType: school.outroMimeType, sizeBytes: school.outroSizeBytes }
      : null,
  };
}

/** Map a device to its dashboard DTO. Never leaks the token hash. */
export function toDeviceDto(device: Device): DeviceDto {
  return {
    id: device.id,
    schoolId: device.schoolId,
    name: device.name,
    roomId: device.roomId,
    isAudioSource: device.isAudioSource,
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
  materials: {
    orderBy: { createdAt: 'asc' },
    include: { library: { select: { id: true, kind: true } } },
  },
  recordings: { orderBy: { startedAt: 'asc' } },
  tags: { orderBy: { at: 'asc' } },
  composite: true,
} satisfies Prisma.LessonInclude;

type LessonListRow = Prisma.LessonGetPayload<{ include: typeof lessonListInclude }>;
type LessonDetailRow = Prisma.LessonGetPayload<{ include: typeof lessonDetailInclude }>;

export function toLessonTagDto(tag: LessonTag): LessonTagDto {
  return {
    id: tag.id,
    lessonId: tag.lessonId,
    label: tag.label,
    at: tag.at.toISOString(),
    createdAt: tag.createdAt.toISOString(),
  };
}

type MaterialRow = Material & { library?: { id: string; kind: string } | null };

export function toMaterialDto(material: MaterialRow): MaterialDto {
  return {
    id: material.id,
    lessonId: material.lessonId,
    title: material.title,
    url: material.url,
    note: material.note,
    library: material.library
      ? { id: material.library.id, kind: material.library.kind as LibraryKind }
      : null,
    createdAt: material.createdAt.toISOString(),
  };
}

export function toLibraryItemDto(item: LibraryItem): LibraryItemDto {
  return {
    id: item.id,
    ownerId: item.ownerId,
    title: item.title,
    description: item.description,
    kind: item.kind as LibraryKind,
    url: item.url,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    status: item.status as LibraryStatus,
    createdAt: item.createdAt.toISOString(),
  };
}

export function toLessonDto(lesson: LessonListRow, holidayName: string | null = null): LessonDto {
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
    holidayName,
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

type ComposedSourceRow = ComposedSource & { members: ComposedSourceMember[] };

export function toComposedSourceDto(source: ComposedSourceRow): ComposedSourceDto {
  return {
    id: source.id,
    schoolId: source.schoolId,
    roomId: source.roomId,
    name: source.name,
    members: [...source.members]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        deviceId: m.deviceId,
        role: m.role as 'main' | 'pip',
        position: (m.position as ComposedSourceMemberDto['position']) ?? null,
        scale: m.scale,
      })),
    createdAt: source.createdAt.toISOString(),
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
  const crop =
    recording.cropX !== null &&
    recording.cropY !== null &&
    recording.cropW !== null &&
    recording.cropH !== null
      ? { x: recording.cropX, y: recording.cropY, w: recording.cropW, h: recording.cropH }
      : null;
  return {
    id: recording.id,
    lessonId: recording.lessonId,
    deviceId: recording.deviceId,
    status: recording.status as RecordingStatus,
    hasVideo: recording.hasVideo,
    hasAudio: recording.hasAudio,
    isAudioTrack: recording.isAudioTrack,
    crop,
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
    studentNotes: lesson.studentNotes,
    devices: lesson.devices.map((d) => ({ id: d.device.id, name: d.device.name })),
    materials: lesson.materials.map(toMaterialDto),
    recordings: lesson.recordings.map(toRecordingDto),
    tags: lesson.tags.map(toLessonTagDto),
    composite: lesson.composite ? toCompositeVideoDto(lesson.composite) : null,
  };
}

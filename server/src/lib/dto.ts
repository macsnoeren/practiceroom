import type { Device, Material, Prisma, School, User } from '@prisma/client';
import type {
  DeviceDto,
  LessonDetailDto,
  LessonDto,
  LessonStatus,
  MaterialDto,
  Role,
  SchoolDto,
  UserDto,
} from '@practiceroom/shared';

/** Map a database user to the client-facing DTO. Never leaks the password hash. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    schoolId: user.schoolId,
    email: user.email,
    name: user.name,
    role: user.role as Role,
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

/** Prisma include shared by the lesson list endpoints. */
export const lessonListInclude = {
  teacher: personSelect,
  student: personSelect,
} satisfies Prisma.LessonInclude;

/** Prisma include for a full lesson (with cameras and material). */
export const lessonDetailInclude = {
  teacher: personSelect,
  student: personSelect,
  devices: { include: { device: { select: { id: true, name: true } } } },
  materials: { orderBy: { createdAt: 'asc' } },
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
    createdAt: lesson.createdAt.toISOString(),
  };
}

export function toLessonDetailDto(lesson: LessonDetailRow): LessonDetailDto {
  return {
    ...toLessonDto(lesson),
    devices: lesson.devices.map((d) => ({ id: d.device.id, name: d.device.name })),
    materials: lesson.materials.map(toMaterialDto),
  };
}

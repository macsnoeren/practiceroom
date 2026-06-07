import type { Device, School, User } from '@prisma/client';
import type { DeviceDto, Role, SchoolDto, UserDto } from '@practiceroom/shared';

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

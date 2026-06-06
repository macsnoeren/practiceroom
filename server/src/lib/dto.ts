import type { School, User } from '@prisma/client';
import type { Role, SchoolDto, UserDto } from '@practiceroom/shared';

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

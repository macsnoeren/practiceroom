import type { AuthUser } from '../auth/plugin.js';

/** Admin manages any lesson in the school; a teacher only their own. */
export function canManageLesson(user: AuthUser, lesson: { teacherId: string }): boolean {
  return user.role === 'admin' || (user.role === 'teacher' && lesson.teacherId === user.id);
}

/** Admin, the lesson's teacher, or the lesson's student may view it. */
export function canViewLesson(
  user: AuthUser,
  lesson: { teacherId: string; studentId: string },
): boolean {
  return user.role === 'admin' || lesson.teacherId === user.id || lesson.studentId === user.id;
}

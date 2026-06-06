import { z } from 'zod';

/**
 * Shared contracts between server, web and (later) the camera app.
 * This package is the single source of truth for data that crosses the
 * client <-> server boundary. Validate with these schemas on both sides.
 */

export const APP_NAME = 'PracticeRoom';

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export const ROLES = ['admin', 'teacher', 'student'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/** Response shape of the server health endpoint. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

const emailField = z.string().trim().toLowerCase().email().max(200);
const passwordField = z.string().min(8, 'Wachtwoord moet minimaal 8 tekens zijn').max(200);
const nameField = z.string().trim().min(1).max(120);

/** Bootstrap a new school together with its first admin user. */
export const RegisterSchoolSchema = z.object({
  schoolName: nameField,
  adminName: nameField,
  email: emailField,
  password: passwordField,
});
export type RegisterSchoolInput = z.infer<typeof RegisterSchoolSchema>;

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Admin creates a teacher or student within their own school. */
export const CreateUserSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  role: z.enum(['teacher', 'student']),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/* -------------------------------------------------------------------------- */
/* DTOs (responses)                                                           */
/* -------------------------------------------------------------------------- */

/** A user as exposed to clients. Never includes the password hash. */
export const UserDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const SchoolDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type SchoolDto = z.infer<typeof SchoolDtoSchema>;

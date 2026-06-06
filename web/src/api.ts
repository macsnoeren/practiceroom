import { z } from 'zod';
import {
  SchoolDtoSchema,
  UserDtoSchema,
  type CreateUserInput,
  type LoginInput,
  type RegisterSchoolInput,
  type SchoolDto,
  type UserDto,
} from '@practiceroom/shared';

/** Error carrying the HTTP status and the server's human-readable message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const RegisterResultSchema = z.object({ user: UserDtoSchema, school: SchoolDtoSchema });
export type RegisterResult = { user: UserDto; school: SchoolDto };

const OkSchema = z.object({ ok: z.boolean() });

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Er ging iets mis (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return schema.parse(data);
}

export const api = {
  me: () => request('/api/auth/me', UserDtoSchema),
  login: (input: LoginInput) =>
    request('/api/auth/login', UserDtoSchema, { method: 'POST', body: JSON.stringify(input) }),
  registerSchool: (input: RegisterSchoolInput) =>
    request('/api/auth/register-school', RegisterResultSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => request('/api/auth/logout', OkSchema, { method: 'POST' }),
  createUser: (input: CreateUserInput) =>
    request('/api/users', UserDtoSchema, { method: 'POST', body: JSON.stringify(input) }),
  listUsers: () => request('/api/users', z.array(UserDtoSchema)),
};

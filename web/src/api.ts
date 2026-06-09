import { z } from 'zod';
import {
  CreateDeviceResultSchema,
  DeviceDtoSchema,
  CompositeVideoDtoSchema,
  HolidayDtoSchema,
  LessonDetailDtoSchema,
  LessonDtoSchema,
  LessonTagDtoSchema,
  MaterialDtoSchema,
  PairingCodeResultSchema,
  PlaybackUrlSchema,
  RecordingDtoSchema,
  RoomDtoSchema,
  SchoolDtoSchema,
  UserDtoSchema,
  TwoFactorSetupSchema,
  InvitePreviewSchema,
  type CreateHolidayInput,
  type CreateLessonInput,
  type CreateMaterialInput,
  type CreateUserInput,
  type LoginInput,
  type RegisterSchoolInput,
  type SchoolDto,
  type UpdateLessonInput,
  type UpdateProfileInput,
  type UpdateUserInput,
  type UserDto,
} from '@practiceroom/shared';

/** Error carrying the HTTP status and the server's human-readable message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Set when the login needs a second factor (TOTP) code. */
    public readonly twofa = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const RegisterResultSchema = z.object({ user: UserDtoSchema, school: SchoolDtoSchema });
export type RegisterResult = { user: UserDto; school: SchoolDto };

const OkSchema = z.object({ ok: z.boolean() });

/**
 * Only send a JSON content-type when there is actually a body. A DELETE or a
 * bodyless POST with `content-type: application/json` makes Fastify reject the
 * request ("Body cannot be empty...").
 */
function jsonInit(init?: RequestInit): RequestInit {
  return {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  };
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(path, jsonInit(init));

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Er ging iets mis (${res.status})`;
    const twofa = !!(data && (data as { twofa?: unknown }).twofa === true);
    throw new ApiError(res.status, message, twofa);
  }

  return schema.parse(data);
}

/** Like `request`, but for endpoints that return no body (e.g. 204). */
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, jsonInit(init));
  if (!res.ok) {
    const text = await res.text();
    let message = `Er ging iets mis (${res.status})`;
    try {
      const data: unknown = text ? JSON.parse(text) : null;
      if (data && typeof (data as { error?: unknown }).error === 'string') {
        message = (data as { error: string }).error;
      }
    } catch {
      // non-JSON body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
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
  updateUser: (id: string, input: UpdateUserInput) =>
    request(`/api/users/${id}`, UserDtoSchema, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteUser: (id: string) => requestVoid(`/api/users/${id}`, { method: 'DELETE' }),

  verifyEmail: (token: string) =>
    request('/api/auth/verify-email', OkSchema, {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: () => request('/api/auth/verify-email/resend', OkSchema, { method: 'POST' }),
  forgotPassword: (email: string) =>
    request('/api/auth/forgot-password', OkSchema, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request('/api/auth/reset-password', OkSchema, {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  getInvite: (token: string) =>
    request(`/api/auth/invite?token=${encodeURIComponent(token)}`, InvitePreviewSchema),
  acceptInvite: (token: string, password: string, name?: string) =>
    request('/api/auth/accept-invite', UserDtoSchema, {
      method: 'POST',
      body: JSON.stringify({ token, password, ...(name ? { name } : {}) }),
    }),

  updateProfile: (input: UpdateProfileInput) =>
    request('/api/auth/me', UserDtoSchema, { method: 'PATCH', body: JSON.stringify(input) }),
  twoFactorSetup: () => request('/api/auth/2fa/setup', TwoFactorSetupSchema, { method: 'POST' }),
  twoFactorEnable: (code: string) =>
    request('/api/auth/2fa/enable', OkSchema, { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorDisable: (code: string) =>
    request('/api/auth/2fa/disable', OkSchema, { method: 'POST', body: JSON.stringify({ code }) }),

  listDevices: () => request('/api/devices', z.array(DeviceDtoSchema)),
  createDevice: (name: string) =>
    request('/api/devices', CreateDeviceResultSchema, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  regeneratePairingCode: (id: string) =>
    request(`/api/devices/${id}/pairing-code`, PairingCodeResultSchema, { method: 'POST' }),
  revokeDevice: (id: string) =>
    request(`/api/devices/${id}/revoke`, DeviceDtoSchema, { method: 'POST' }),
  deleteDevice: (id: string) => requestVoid(`/api/devices/${id}`, { method: 'DELETE' }),

  listLessons: () => request('/api/lessons', z.array(LessonDtoSchema)),
  // Lessons where the caller is the student (works for any role). Includes
  // lessons that lapse due to a holiday, marked with the holiday's name.
  listMyLessons: () =>
    request('/api/lessons?student=me&includeLapsed=true', z.array(LessonDtoSchema)),
  getLesson: (id: string) => request(`/api/lessons/${id}`, LessonDetailDtoSchema),
  createLesson: (input: CreateLessonInput) =>
    request('/api/lessons', LessonDtoSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateLesson: (id: string, input: UpdateLessonInput) =>
    request(`/api/lessons/${id}`, LessonDtoSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updateStudentNotes: (id: string, studentNotes: string | null) =>
    request(`/api/lessons/${id}/student-notes`, LessonDetailDtoSchema, {
      method: 'PATCH',
      body: JSON.stringify({ studentNotes }),
    }),
  deleteLesson: (id: string, series = false) =>
    requestVoid(`/api/lessons/${id}${series ? '?series=true' : ''}`, { method: 'DELETE' }),
  setLessonDevices: (id: string, deviceIds: string[]) =>
    request(`/api/lessons/${id}/devices`, LessonDetailDtoSchema, {
      method: 'PUT',
      body: JSON.stringify({ deviceIds }),
    }),
  addMaterial: (id: string, input: CreateMaterialInput) =>
    request(`/api/lessons/${id}/materials`, MaterialDtoSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteMaterial: (lessonId: string, materialId: string) =>
    requestVoid(`/api/lessons/${lessonId}/materials/${materialId}`, { method: 'DELETE' }),
  addTag: (lessonId: string, label: string) =>
    request(`/api/lessons/${lessonId}/tags`, LessonTagDtoSchema, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  deleteTag: (lessonId: string, tagId: string) =>
    requestVoid(`/api/lessons/${lessonId}/tags/${tagId}`, { method: 'DELETE' }),

  startRecording: (lessonId: string, deviceId: string) =>
    request(`/api/lessons/${lessonId}/recording/start`, RecordingDtoSchema, {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    }),
  stopRecording: (lessonId: string) =>
    request(`/api/lessons/${lessonId}/recording/stop`, z.object({ stopped: z.number() }), {
      method: 'POST',
    }),
  finishRecording: (lessonId: string) =>
    request(`/api/lessons/${lessonId}/recording/finish`, CompositeVideoDtoSchema, {
      method: 'POST',
    }),
  getPlaybackUrl: (recordingId: string) =>
    request(`/api/recordings/${recordingId}/playback-url`, PlaybackUrlSchema),
  getCompositePlaybackUrl: (lessonId: string) =>
    request(`/api/lessons/${lessonId}/composite/playback-url`, PlaybackUrlSchema),

  listHolidays: () => request('/api/holidays', z.array(HolidayDtoSchema)),
  createHoliday: (input: CreateHolidayInput) =>
    request('/api/holidays', HolidayDtoSchema, { method: 'POST', body: JSON.stringify(input) }),
  deleteHoliday: (id: string) => requestVoid(`/api/holidays/${id}`, { method: 'DELETE' }),

  listRooms: () => request('/api/rooms', z.array(RoomDtoSchema)),
  createRoom: (name: string) =>
    request('/api/rooms', RoomDtoSchema, { method: 'POST', body: JSON.stringify({ name }) }),
  deleteRoom: (id: string) => requestVoid(`/api/rooms/${id}`, { method: 'DELETE' }),
};

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

/* -------------------------------------------------------------------------- */
/* Devices (cameras/microphones)                                              */
/* -------------------------------------------------------------------------- */

/** Admin/teacher registers a capture device by name; pairing happens later. */
export const CreateDeviceSchema = z.object({
  name: nameField,
});
export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;

/** The camera app pairs by entering a short code shown in the dashboard. */
export const PairDeviceSchema = z.object({
  pairingCode: z.string().trim().toUpperCase().min(4).max(20),
});
export type PairDeviceInput = z.infer<typeof PairDeviceSchema>;

/** A device as shown in the management dashboard. */
export const DeviceDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  name: z.string(),
  paired: z.boolean(),
  pairedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DeviceDto = z.infer<typeof DeviceDtoSchema>;

/** Returned when a device is created or its code is regenerated. */
export const PairingCodeResultSchema = z.object({
  pairingCode: z.string(),
  pairingExpiresAt: z.string(),
});
export type PairingCodeResult = z.infer<typeof PairingCodeResultSchema>;

export const CreateDeviceResultSchema = z.object({
  device: DeviceDtoSchema,
  pairingCode: z.string(),
  pairingExpiresAt: z.string(),
});
export type CreateDeviceResult = z.infer<typeof CreateDeviceResultSchema>;

/** Camera-app facing: result of a successful pairing. Token is shown once. */
export const DevicePairResultSchema = z.object({
  token: z.string(),
  device: z.object({ id: z.string(), name: z.string() }),
});
export type DevicePairResult = z.infer<typeof DevicePairResultSchema>;

/** Camera-app facing: who am I (validates a stored token). */
export const DeviceSelfSchema = z.object({
  id: z.string(),
  name: z.string(),
  schoolId: z.string(),
});
export type DeviceSelf = z.infer<typeof DeviceSelfSchema>;

/* -------------------------------------------------------------------------- */
/* Lessons & material                                                         */
/* -------------------------------------------------------------------------- */

export const LESSON_STATUSES = ['planned', 'recording', 'recorded', 'ready'] as const;
export const LessonStatusSchema = z.enum(LESSON_STATUSES);
export type LessonStatus = (typeof LESSON_STATUSES)[number];

const PersonMiniSchema = z.object({ id: z.string(), name: z.string() });
export type PersonMini = z.infer<typeof PersonMiniSchema>;

const DeviceMiniSchema = z.object({ id: z.string(), name: z.string() });
export type DeviceMini = z.infer<typeof DeviceMiniSchema>;

/** Create a lesson. A teacher implicitly teaches it; an admin must pick one. */
export const CreateLessonSchema = z.object({
  studentId: z.string().min(1),
  teacherId: z.string().min(1).optional(),
  title: z.string().trim().max(160).optional(),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(600),
});
export type CreateLessonInput = z.infer<typeof CreateLessonSchema>;

export const UpdateLessonSchema = z.object({
  studentId: z.string().min(1).optional(),
  title: z.string().trim().max(160).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  status: LessonStatusSchema.optional(),
});
export type UpdateLessonInput = z.infer<typeof UpdateLessonSchema>;

/** Replace the set of cameras that film a lesson. */
export const SetLessonDevicesSchema = z.object({
  deviceIds: z.array(z.string()),
});
export type SetLessonDevicesInput = z.infer<typeof SetLessonDevicesSchema>;

export const CreateMaterialSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    url: z.string().url().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((m) => m.url !== undefined || m.note !== undefined, {
    message: 'Voeg een link of een notitie toe',
  });
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

export const MaterialDtoSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type MaterialDto = z.infer<typeof MaterialDtoSchema>;

export const LessonDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  teacher: PersonMiniSchema,
  student: PersonMiniSchema,
  title: z.string().nullable(),
  startsAt: z.string(),
  durationMinutes: z.number(),
  status: LessonStatusSchema,
  createdAt: z.string(),
});
export type LessonDto = z.infer<typeof LessonDtoSchema>;

export const RECORDING_STATUSES = ['recording', 'completed', 'failed'] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const RecordingDtoSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  deviceId: z.string(),
  status: RecordingStatusSchema,
  sizeBytes: z.number(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type RecordingDto = z.infer<typeof RecordingDtoSchema>;

/** Device-facing: progress of an in-flight upload, used to resume. */
export const RecordingResumeSchema = z.object({
  id: z.string(),
  status: RecordingStatusSchema,
  receivedChunks: z.number(),
});
export type RecordingResume = z.infer<typeof RecordingResumeSchema>;

/** A short-lived, signed URL to stream a recording back. */
export const PlaybackUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type PlaybackUrl = z.infer<typeof PlaybackUrlSchema>;

/** Staff starts recording on ONE specific camera (switching stops the rest). */
export const StartRecordingInputSchema = z.object({
  deviceId: z.string().min(1),
});
export type StartRecordingInput = z.infer<typeof StartRecordingInputSchema>;

/** The single combined lesson video produced by the worker. */
export const COMPOSITE_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export const CompositeStatusSchema = z.enum(COMPOSITE_STATUSES);
export type CompositeStatus = (typeof COMPOSITE_STATUSES)[number];

export const CompositeVideoDtoSchema = z.object({
  status: CompositeStatusSchema,
  sizeBytes: z.number(),
  error: z.string().nullable(),
});
export type CompositeVideoDto = z.infer<typeof CompositeVideoDtoSchema>;

export const LessonDetailDtoSchema = LessonDtoSchema.extend({
  devices: z.array(DeviceMiniSchema),
  materials: z.array(MaterialDtoSchema),
  recordings: z.array(RecordingDtoSchema),
  composite: CompositeVideoDtoSchema.nullable(),
});
export type LessonDetailDto = z.infer<typeof LessonDetailDtoSchema>;

/* -------------------------------------------------------------------------- */
/* Realtime (Socket.IO)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Event names used on the websocket. Centralised so client and server cannot
 * drift. Direction is noted per event.
 */
export const SOCKET_EVENTS = {
  /** server -> staff: full list of currently online devices (on connect). */
  presenceSnapshot: 'presence:snapshot',
  /** server -> staff: a device came online. */
  deviceOnline: 'device:online',
  /** server -> staff: a device went offline. */
  deviceOffline: 'device:offline',
  /** staff -> server -> device: begin recording on the given devices. */
  recordingStart: 'recording:start',
  /** staff -> server -> device: stop recording on the given devices. */
  recordingStop: 'recording:stop',
  /** device -> server: report its current state. */
  statusUpdate: 'status:update',
  /** server -> staff: a device reported a new state. */
  deviceStatus: 'device:status',
} as const;

/** A device that is currently connected. */
export const OnlineDeviceSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
});
export type OnlineDevice = z.infer<typeof OnlineDeviceSchema>;

export const PresenceSnapshotSchema = z.object({
  devices: z.array(OnlineDeviceSchema),
});
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;

export const DeviceOfflineSchema = z.object({ deviceId: z.string() });
export type DeviceOffline = z.infer<typeof DeviceOfflineSchema>;

/** Server -> device: start recording into the given Recording. */
export const StartRecordingMsgSchema = z.object({
  recordingId: z.string(),
  lessonId: z.string(),
});
export type StartRecordingMsg = z.infer<typeof StartRecordingMsgSchema>;

/** Server -> device: stop the given recording. */
export const StopRecordingMsgSchema = z.object({
  recordingId: z.string(),
});
export type StopRecordingMsg = z.infer<typeof StopRecordingMsgSchema>;

export const DEVICE_STATES = ['idle', 'recording', 'error'] as const;
export const DeviceStateSchema = z.enum(DEVICE_STATES);
export type DeviceState = (typeof DEVICE_STATES)[number];

/** Device -> server: a device's own status. */
export const DeviceStatusSchema = z.object({
  state: DeviceStateSchema,
  message: z.string().max(300).optional(),
});
export type DeviceStatusInput = z.infer<typeof DeviceStatusSchema>;

/** Server -> staff: a device's status, tagged with which device. */
export const DeviceStatusUpdateSchema = z.object({
  deviceId: z.string(),
  state: DeviceStateSchema,
  message: z.string().max(300).optional(),
});
export type DeviceStatusUpdate = z.infer<typeof DeviceStatusUpdateSchema>;

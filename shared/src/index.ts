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

// A site-wide superadmin is a user that belongs to no school. It is not an
// assignable role (you cannot pick it in the UI), so it lives in its own,
// wider enum used only for reading a user back.
export const USER_ROLES = [...ROLES, 'superadmin'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = (typeof USER_ROLES)[number];

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
  // Required only when the account has two-factor authentication enabled.
  code: z.string().trim().optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Admin creates a teacher or student within their own school. Without a
 * password the user is invited by e-mail to choose one themselves. */
export const CreateUserSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField.optional(),
  role: z.enum(['teacher', 'student']),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/** Confirm an e-mail address (or accept an invite / reset) via a token link. */
export const TokenSchema = z.object({ token: z.string().min(1).max(200) });
export type TokenInput = z.infer<typeof TokenSchema>;

/** Request a password-reset link by e-mail. */
export const ForgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** Set a new password using a reset token. */
export const ResetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordField,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/** Accept an invitation: choose a password (and optionally adjust the name). */
export const AcceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  name: nameField.optional(),
  password: passwordField,
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

/** Shown on the invite-acceptance page so the user sees who they are. */
export const InvitePreviewSchema = z.object({ email: z.string(), name: z.string() });
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

/** Admin edits a user in their school (any field is optional). */
export const UpdateUserSchema = z.object({
  name: nameField.optional(),
  email: emailField.optional(),
  role: RoleSchema.optional(),
  password: passwordField.optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/** A user edits their own profile. Changing the password needs the current one. */
export const UpdateProfileSchema = z
  .object({
    name: nameField.optional(),
    email: emailField.optional(),
    currentPassword: z.string().min(1).max(200).optional(),
    newPassword: passwordField.optional(),
  })
  .refine((p) => !p.newPassword || !!p.currentPassword, {
    message: 'Vul je huidige wachtwoord in om het te wijzigen',
    path: ['currentPassword'],
  });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** A 6–8 digit time-based one-time code. */
export const TwoFactorCodeSchema = z.object({
  code: z.string().trim().min(6).max(8),
});
export type TwoFactorCodeInput = z.infer<typeof TwoFactorCodeSchema>;

/** Returned when starting 2FA setup: the otpauth URL (for a QR) and secret. */
export const TwoFactorSetupSchema = z.object({
  otpauthUrl: z.string(),
  secret: z.string(),
});
export type TwoFactorSetup = z.infer<typeof TwoFactorSetupSchema>;

/* -------------------------------------------------------------------------- */
/* DTOs (responses)                                                           */
/* -------------------------------------------------------------------------- */

/** A user as exposed to clients. Never includes the password hash. */
export const UserDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string().nullable(),
  email: z.string(),
  name: z.string(),
  role: UserRoleSchema,
  emailVerified: z.boolean(),
  totpEnabled: z.boolean(),
  // For a superadmin: the school they have currently entered (acting as admin),
  // or null when on the site dashboard. Always null for normal users.
  activeSchoolId: z.string().nullable(),
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
/* Site administration (superadmin)                                           */
/* -------------------------------------------------------------------------- */

/** One-time creation of the first site-wide administrator. */
export const SiteAdminSetupSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
});
export type SiteAdminSetupInput = z.infer<typeof SiteAdminSetupSchema>;

export const EnterSchoolSchema = z.object({ schoolId: z.string().min(1) });
export type EnterSchoolInput = z.infer<typeof EnterSchoolSchema>;

/** One of the schools the logged-in user is a member of, with their role there. */
export const MySchoolDtoSchema = z.object({
  schoolId: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type MySchoolDto = z.infer<typeof MySchoolDtoSchema>;

/** A member switches the school their session is currently acting within. */
export const SwitchSchoolSchema = z.object({ schoolId: z.string().min(1) });
export type SwitchSchoolInput = z.infer<typeof SwitchSchoolSchema>;

/** The site admin creates a new (empty) school. */
export const CreateSchoolSchema = z.object({ name: nameField });
export type CreateSchoolInput = z.infer<typeof CreateSchoolSchema>;

/** A school in the site-admin overview, with a few counts. */
export const SchoolSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  userCount: z.number(),
  lessonCount: z.number(),
  createdAt: z.string(),
});
export type SchoolSummaryDto = z.infer<typeof SchoolSummaryDtoSchema>;

/** A user in the global (cross-school) site-admin user list. */
export const GlobalUserDtoSchema = UserDtoSchema.extend({
  schoolName: z.string().nullable(),
});
export type GlobalUserDto = z.infer<typeof GlobalUserDtoSchema>;

/* ---- Audit log (site-admin) ---------------------------------------------- */

/** One security-relevant event in the site-admin audit trail. */
export const AuditLogDtoSchema = z.object({
  id: z.string(),
  action: z.string(),
  schoolId: z.string().nullable(),
  schoolName: z.string().nullable(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  ip: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogDto = z.infer<typeof AuditLogDtoSchema>;

/** Filters for the audit-log list: a free-text search, an optional exact action
 * or school filter, and 1-based pagination (capped so a huge table stays fast). */
export const AuditLogQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  action: z.string().max(100).optional(),
  schoolId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/** A page of audit-log entries plus the total count for pagination controls. */
export const AuditLogPageDtoSchema = z.object({
  items: z.array(AuditLogDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type AuditLogPageDto = z.infer<typeof AuditLogPageDtoSchema>;

/* -------------------------------------------------------------------------- */
/* Devices (cameras/microphones)                                              */
/* -------------------------------------------------------------------------- */

/** A capture device records; a speaker only plays the room's sync tone. */
export const DEVICE_KINDS = ['camera', 'speaker'] as const;
export const DeviceKindSchema = z.enum(DEVICE_KINDS);
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Admin/teacher registers a device by name (and kind); pairing happens later. */
export const CreateDeviceSchema = z.object({
  name: nameField,
  kind: DeviceKindSchema.default('camera'),
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
  kind: DeviceKindSchema,
  roomId: z.string().nullable(),
  isAudioSource: z.boolean(),
  // Calibration: ms this device's video lags its audio (positive = behind).
  videoOffsetMs: z.number().int(),
  paired: z.boolean(),
  pairedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DeviceDto = z.infer<typeof DeviceDtoSchema>;

/** Staff assigns a device to a room, marks it the audio source, or calibrates
 * its video offset (ms its video lags its audio; positive = behind). */
export const UpdateDeviceSchema = z.object({
  roomId: z.string().min(1).nullable().optional(),
  isAudioSource: z.boolean().optional(),
  videoOffsetMs: z.number().int().min(-2000).max(2000).optional(),
});
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;

/* ---- Composed sources (picture-in-picture of several cameras) ------------- */

/** Corner an inset camera is placed in. */
export const PIP_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const;
export const PipPositionSchema = z.enum(PIP_POSITIONS);
export type PipPosition = (typeof PIP_POSITIONS)[number];

/** Inset size presets, expressed as a fraction of the frame width. */
export const PIP_SIZES = { small: 0.2, medium: 0.28, large: 0.36 } as const;
export const PIP_SIZE_NAMES = ['small', 'medium', 'large'] as const;
export const PipSizeSchema = z.enum(PIP_SIZE_NAMES);
export type PipSize = (typeof PIP_SIZE_NAMES)[number];

export const ComposedSourceMemberDtoSchema = z.object({
  deviceId: z.string(),
  role: z.enum(['main', 'pip']),
  position: PipPositionSchema.nullable(),
  scale: z.number().nullable(),
});
export type ComposedSourceMemberDto = z.infer<typeof ComposedSourceMemberDtoSchema>;

export const ComposedSourceDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  roomId: z.string(),
  name: z.string(),
  // The device that provides this source's sound (null = use the room's audio
  // source). May be a video member or a separate sound-only device.
  audioDeviceId: z.string().nullable(),
  members: z.array(ComposedSourceMemberDtoSchema),
  createdAt: z.string(),
});
export type ComposedSourceDto = z.infer<typeof ComposedSourceDtoSchema>;

/** One member when creating/updating a composed source. */
export const ComposedSourceMemberInputSchema = z.object({
  deviceId: z.string().min(1),
  role: z.enum(['main', 'pip']),
  position: PipPositionSchema.optional(),
  size: PipSizeSchema.optional(),
});

const composedSourceBody = {
  name: z.string().trim().min(1).max(120),
  roomId: z.string().min(1),
  // Any device may be the audio source (incl. sound-only, or outside the room);
  // null falls back to the room's audio source.
  audioDeviceId: z.string().min(1).nullable().optional(),
  members: z.array(ComposedSourceMemberInputSchema).min(1).max(5),
};

/** Exactly one main camera; pips carry a corner position. */
const oneMain = (d: { members: { role: 'main' | 'pip' }[] }) =>
  d.members.filter((m) => m.role === 'main').length === 1;

export const CreateComposedSourceSchema = z
  .object(composedSourceBody)
  .refine(oneMain, { message: 'Kies precies één hoofdcamera' });
export type CreateComposedSourceInput = z.infer<typeof CreateComposedSourceSchema>;

export const UpdateComposedSourceSchema = z
  .object(composedSourceBody)
  .refine(oneMain, { message: 'Kies precies één hoofdcamera' });
export type UpdateComposedSourceInput = z.infer<typeof UpdateComposedSourceSchema>;

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
  kind: DeviceKindSchema,
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

/** Create a lesson. A teacher implicitly teaches it; an admin must pick one.
 * `repeatWeeks` > 1 plans the same lesson weekly for that many weeks (holiday
 * weeks are skipped). */
export const CreateLessonSchema = z.object({
  studentId: z.string().min(1),
  teacherId: z.string().min(1).optional(),
  title: z.string().trim().max(160).optional(),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(600),
  repeatWeeks: z.number().int().min(1).max(52).optional(),
  roomId: z.string().min(1).optional(),
});
export type CreateLessonInput = z.infer<typeof CreateLessonSchema>;

/** A room/location. */
export const CreateRoomSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

export const RoomDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type RoomDto = z.infer<typeof RoomDtoSchema>;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Gebruik een datum (JJJJ-MM-DD)');

/** A school holiday/break period (date-only, inclusive). */
export const CreateHolidaySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsOn: dateOnly,
    endsOn: dateOnly,
  })
  .refine((h) => h.endsOn >= h.startsOn, {
    message: 'De einddatum mag niet vóór de startdatum liggen',
    path: ['endsOn'],
  });
export type CreateHolidayInput = z.infer<typeof CreateHolidaySchema>;

export const HolidayDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  createdAt: z.string(),
});
export type HolidayDto = z.infer<typeof HolidayDtoSchema>;

export const UpdateLessonSchema = z.object({
  studentId: z.string().min(1).optional(),
  title: z.string().trim().max(160).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  status: LessonStatusSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
  roomId: z.string().min(1).nullable().optional(),
});
export type UpdateLessonInput = z.infer<typeof UpdateLessonSchema>;

/** The lesson's student edits their own notes/questions. */
export const UpdateStudentNotesSchema = z.object({
  studentNotes: z.string().max(5000).nullable(),
});
export type UpdateStudentNotesInput = z.infer<typeof UpdateStudentNotesSchema>;

/** Replace the set of cameras that film a lesson. */
export const SetLessonDevicesSchema = z.object({
  deviceIds: z.array(z.string()),
});
export type SetLessonDevicesInput = z.infer<typeof SetLessonDevicesSchema>;

export const CreateMaterialSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    url: z
      .string()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), {
        message: 'Alleen http(s)-links zijn toegestaan',
      })
      .optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((m) => m.url !== undefined || m.note !== undefined, {
    message: 'Voeg een link of een notitie toe',
  });
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

export const LIBRARY_KINDS = ['file', 'link'] as const;
export const LibraryKindSchema = z.enum(LIBRARY_KINDS);
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const MaterialDtoSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  note: z.string().nullable(),
  // Present when the material is a video from the teacher's library.
  library: z.object({ id: z.string(), kind: LibraryKindSchema }).nullable(),
  createdAt: z.string(),
});
export type MaterialDto = z.infer<typeof MaterialDtoSchema>;

/* ---- Teacher video library ---------------------------------------------- */

const libraryLink = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), { message: 'Alleen http(s)-links zijn toegestaan' });

/** Create a library item: an external link, or a file you then upload. */
export const CreateLibraryItemSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    kind: LibraryKindSchema,
    url: libraryLink.optional(),
  })
  .refine((i) => i.kind !== 'link' || !!i.url, {
    message: 'Een link is verplicht',
    path: ['url'],
  });
export type CreateLibraryItemInput = z.infer<typeof CreateLibraryItemSchema>;

/** Save a lesson's combined video into the library. */
export const SaveFromLessonSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
});
export type SaveFromLessonInput = z.infer<typeof SaveFromLessonSchema>;

export const UpdateLibraryItemSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateLibraryItemInput = z.infer<typeof UpdateLibraryItemSchema>;

/** Attach a library item to a lesson as extra material. */
export const AttachLibrarySchema = z.object({ libraryItemId: z.string().min(1) });
export type AttachLibraryInput = z.infer<typeof AttachLibrarySchema>;

export const LIBRARY_STATUSES = ['uploading', 'ready'] as const;
export const LibraryStatusSchema = z.enum(LIBRARY_STATUSES);
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const LibraryItemDtoSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: LibraryKindSchema,
  url: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
  status: LibraryStatusSchema,
  createdAt: z.string(),
});
export type LibraryItemDto = z.infer<typeof LibraryItemDtoSchema>;

/* ---- School settings (branding) ----------------------------------------- */

export const BRANDING_SLOTS = ['intro', 'outro'] as const;
export const BrandingSlotSchema = z.enum(BRANDING_SLOTS);
export type BrandingSlot = (typeof BRANDING_SLOTS)[number];

/** Admin updates the watermark text shown on every combined lesson video. */
export const UpdateSettingsSchema = z.object({
  overlayText: z.string().trim().max(200).nullable(),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

const BrandingClipSchema = z.object({ mimeType: z.string(), sizeBytes: z.number() }).nullable();

export const SchoolSettingsDtoSchema = z.object({
  overlayText: z.string().nullable(),
  intro: BrandingClipSchema,
  outro: BrandingClipSchema,
});
export type SchoolSettingsDto = z.infer<typeof SchoolSettingsDtoSchema>;

/** A timeline marker placed during a lesson (for later review/editing). */
export const CreateTagSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
export type CreateTagInput = z.infer<typeof CreateTagSchema>;

export const LessonTagDtoSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  label: z.string(),
  at: z.string(),
  createdAt: z.string(),
});
export type LessonTagDto = z.infer<typeof LessonTagDtoSchema>;

export const LessonDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  teacher: PersonMiniSchema,
  student: PersonMiniSchema,
  title: z.string().nullable(),
  startsAt: z.string(),
  durationMinutes: z.number(),
  status: LessonStatusSchema,
  seriesId: z.string().nullable(),
  notes: z.string().nullable(),
  room: z.object({ id: z.string(), name: z.string() }).nullable(),
  // Set when the lesson falls within a school holiday (it then lapses); the
  // value is the holiday's name. Null otherwise.
  holidayName: z.string().nullable(),
  createdAt: z.string(),
});
export type LessonDto = z.infer<typeof LessonDtoSchema>;

export const RECORDING_STATUSES = ['recording', 'completed', 'failed'] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/**
 * A crop rectangle, expressed as fractions (0–1) of the source frame: the
 * camera draws it on its preview and the worker applies it server-side, so the
 * full original is always preserved. The rectangle must lie within the frame
 * and have a positive size.
 */
export const CropRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((c) => c.w > 0 && c.h > 0 && c.x + c.w <= 1 && c.y + c.h <= 1, {
    message: 'Ongeldig kader',
  });
export type CropRect = z.infer<typeof CropRectSchema>;

export const RecordingDtoSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  deviceId: z.string(),
  status: RecordingStatusSchema,
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  // True for a segment captured by a room's audio source: its sound is laid
  // under the paired camera video, so the UI hides it as a standalone segment —
  // unless it is also a video layer (layoutRole set), e.g. a main camera that is
  // its own audio source.
  isAudioTrack: z.boolean(),
  // Layout within a composed source ('main'|'pip'), or null for a single camera.
  layoutRole: z.string().nullable(),
  crop: CropRectSchema.nullable(),
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
// Staff starts a segment from either a single camera or a composed source.
export const StartRecordingInputSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
  })
  .refine((d) => !!d.deviceId !== !!d.sourceId, {
    message: 'Kies een camera of een samengestelde bron',
  });
export type StartRecordingInput = z.infer<typeof StartRecordingInputSchema>;

/** The single combined lesson video produced by the worker. */
export const COMPOSITE_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export const CompositeStatusSchema = z.enum(COMPOSITE_STATUSES);
export type CompositeStatus = (typeof COMPOSITE_STATUSES)[number];

/* ---- Sync diagnostics ----------------------------------------------------- */

/** How one stream of a segment was aligned during compositing. */
export const SyncStreamReportSchema = z.object({
  role: z.string(), // 'main' | 'pip' | 'audio' | 'single'
  deviceId: z.string(),
  hasAudio: z.boolean(),
  durationS: z.number().nullable(),
  toneOnsetS: z.number().nullable(), // detected sync-tone start, or null
  skipS: z.number(), // seconds trimmed from the front to align
  // Detection quality (optional; absent on older reports). riseMs = 10→90% edge
  // rise time (smaller is sharper/more reliable); dominance = 0…~0.5 (higher is
  // a cleaner tone vs background).
  toneRiseMs: z.number().nullable().optional(),
  toneDominance: z.number().nullable().optional(),
});
export type SyncStreamReport = z.infer<typeof SyncStreamReportSchema>;

/** How one segment's layers were aligned. */
export const SyncSegmentReportSchema = z.object({
  segment: z.number(), // 1-based, in final order
  method: z.enum(['tone', 'duration', 'none']),
  streams: z.array(SyncStreamReportSchema),
});
export type SyncSegmentReport = z.infer<typeof SyncSegmentReportSchema>;

export const CompositeVideoDtoSchema = z.object({
  status: CompositeStatusSchema,
  sizeBytes: z.number(),
  error: z.string().nullable(),
  // Per-segment alignment diagnostics from the last build (null until built).
  sync: z.array(SyncSegmentReportSchema).nullable(),
});
export type CompositeVideoDto = z.infer<typeof CompositeVideoDtoSchema>;

export const LessonDetailDtoSchema = LessonDtoSchema.extend({
  studentNotes: z.string().nullable(),
  devices: z.array(DeviceMiniSchema),
  materials: z.array(MaterialDtoSchema),
  recordings: z.array(RecordingDtoSchema),
  tags: z.array(LessonTagDtoSchema),
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
  /** device -> server -> staff: a low-res preview snapshot from a camera. */
  cameraFrame: 'camera:frame',
  /** staff -> server -> device: set a camera's microphone gain. */
  micSetGain: 'mic:set-gain',
  /** device -> server -> staff: report a camera's current microphone gain. */
  micGain: 'mic:gain',
  /** device -> server -> staff: a camera's live microphone level (for testing). */
  micLevel: 'mic:level',
  /** device -> server -> staff: a recording segment was successfully completed. */
  recordingCompleted: 'recording:completed',
  /** server -> speaker device: play the sync tone now (start signal + marker). */
  syncTone: 'sync:tone',
  /** server -> staff: the sync tone is pending ('armed') or playing now. */
  syncToneStatus: 'sync:tone-status',
} as const;

/* ---- Sync tone (multicam alignment via a speaker in the room) ------------- */

// A speaker plays this tone at the start of a multi-device segment; every mic
// records it, and the worker aligns the streams by detecting it. The clients
// (browser + pi-agent) and the worker must all agree on these values.
export const SYNC_TONE_FREQUENCY_HZ = 1000;
export const SYNC_TONE_DURATION_MS = 2000;
export const SYNC_TONE_FADE_MS = 50;

/** server -> speaker device: details of the tone to play. */
export const SyncTonePayloadSchema = z.object({
  toneId: z.string(),
  frequency: z.number(),
  durationMs: z.number(),
});
export type SyncTonePayload = z.infer<typeof SyncTonePayloadSchema>;

/** server -> staff: where a lesson's start tone is in its lifecycle, so the
 * control room can tell the operator to wait for it. */
export const SyncToneStatusSchema = z.object({
  lessonId: z.string(),
  phase: z.enum(['armed', 'playing']),
  durationMs: z.number().optional(),
});
export type SyncToneStatus = z.infer<typeof SyncToneStatusSchema>;

/** A 0–1 microphone level for the control room's live meter. */
const levelField = z.number().min(0).max(1);

/** device -> server: its current mic level. */
export const MicLevelInputSchema = z.object({ level: levelField });
export type MicLevelInput = z.infer<typeof MicLevelInputSchema>;

/** server -> staff: a camera's mic level, tagged with its device. */
export const MicLevelSchema = z.object({ deviceId: z.string(), level: levelField });
export type MicLevel = z.infer<typeof MicLevelSchema>;

/** A microphone gain multiplier: 0 = muted, 1 = unchanged, up to 2 = +100%. */
const gainField = z.number().min(0).max(2);

/** staff -> server: set the gain of a specific camera's microphone. */
export const MicSetGainSchema = z.object({ deviceId: z.string(), gain: gainField });
export type MicSetGainInput = z.infer<typeof MicSetGainSchema>;

/** server -> device: the gain to apply (the device already knows it is itself). */
export const MicGainCommandSchema = z.object({ gain: gainField });
export type MicGainCommand = z.infer<typeof MicGainCommandSchema>;

/** server -> staff: a camera reported its current microphone gain. */
export const MicGainSchema = z.object({ deviceId: z.string(), gain: gainField });
export type MicGain = z.infer<typeof MicGainSchema>;

/** device -> server: a single preview snapshot (a small JPEG data URL). */
export const CameraFrameInputSchema = z.object({
  dataUrl: z
    .string()
    .max(400_000)
    .refine((s) => s.startsWith('data:image/'), 'Alleen afbeeldingen zijn toegestaan'),
});
export type CameraFrameInput = z.infer<typeof CameraFrameInputSchema>;

/** server -> staff: a preview snapshot tagged with its device. */
export const CameraFrameSchema = z.object({
  deviceId: z.string(),
  dataUrl: z.string(),
});
export type CameraFrame = z.infer<typeof CameraFrameSchema>;

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

/** server -> staff: a recording segment finished uploading and was completed. */
export const RecordingCompletedSchema = z.object({
  recordingId: z.string(),
  lessonId: z.string(),
  deviceId: z.string(),
  sizeBytes: z.number(),
});
export type RecordingCompleted = z.infer<typeof RecordingCompletedSchema>;

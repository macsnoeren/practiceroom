import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_SIGNING_SECRET = 'dev-insecure-signing-secret-change-me';
const DEFAULT_ENCRYPTION_KEY = 'dev-insecure-encryption-key-change-me';

/**
 * Validated environment configuration. Parsed once at startup so a missing or
 * malformed variable fails fast with a clear message instead of surfacing as a
 * confusing runtime error later.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  STORAGE_DIR: z.string().min(1).default('./storage'),
  // Maximum total size (MB) of a single recording segment or library upload.
  // Bounds disk usage so a misbehaving/compromised uploader cannot fill the
  // disk. Kept under 2 GB since sizes are stored as 32-bit ints.
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(2000).default(1024),
  // Secret used to sign playback URLs. Override with a strong value in production.
  SIGNING_SECRET: z.string().min(1).default(DEFAULT_SIGNING_SECRET),
  // Key used to encrypt secrets at rest (e.g. TOTP secrets) with AES-256-GCM.
  // Override with a strong, unique value in production; changing it makes any
  // already-encrypted secret undecryptable (users must re-enroll 2FA).
  ENCRYPTION_KEY: z.string().min(1).default(DEFAULT_ENCRYPTION_KEY),
  // ffmpeg binary path. Empty = use the bundled @ffmpeg-installer binary.
  // Point this at a system/Docker ffmpeg when you have one.
  FFMPEG_PATH: z.string().default(''),
  // ffprobe binary path. Empty = use the bundled @ffprobe-installer binary.
  FFPROBE_PATH: z.string().default(''),
  // TrueType font for the overlay/watermark text. Empty = overlay is skipped
  // (the rest of the video is still produced). In Docker we install DejaVu.
  FONT_PATH: z.string().default(''),
  // Send cookies only over HTTPS. Defaults to on in production. Set to 'false'
  // to test a production build over plain HTTP locally.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  // How much to trust X-Forwarded-* headers, so request.ip is the real client
  // behind a reverse proxy (and rate limiting + audit IPs are correct). Unset =
  // off (direct/dev). Behind one nginx hop use '1'; or 'true' / an IP-subnet
  // list. NEVER enable when the server is reachable directly (XFF is spoofable).
  TRUST_PROXY: z.string().optional(),
  // Public base URL of the dashboard, used to build links in e-mails
  // (verification, password reset, invitations).
  APP_URL: z.string().min(1).default('http://localhost:5173'),
  // Outgoing mail (SMTP). Leave SMTP_HOST empty to disable sending: the app
  // then logs the link it would have mailed instead of failing.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  // From address; falls back to SMTP_USER when empty.
  SMTP_FROM: z.string().default(''),
  // Use a TLS-on-connect socket (port 465). Leave unset to infer from the port
  // (465 = true, otherwise STARTTLS on 587).
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

// In production, refuse to start with the insecure default signing secret.
if (env.NODE_ENV === 'production' && env.SIGNING_SECRET === DEFAULT_SIGNING_SECRET) {
  console.error('SIGNING_SECRET must be set to a strong, unique value in production.');
  process.exit(1);
}

// Likewise refuse the default encryption key in production.
if (env.NODE_ENV === 'production' && env.ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
  console.error('ENCRYPTION_KEY must be set to a strong, unique value in production.');
  process.exit(1);
}

/**
 * Interpret the TRUST_PROXY env value for Fastify's `trustProxy` option:
 * - unset / 'false' / '' -> false (trust nothing; correct for direct exposure)
 * - 'true'               -> trust the whole X-Forwarded-For chain
 * - a non-negative int   -> trust that many hops closest to the server (safe for
 *                           a known number of reverse proxies; ignores spoofed
 *                           left-most entries)
 * - anything else        -> passed through as an IP/subnet allowlist
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0 && String(n) === value) return n;
  return value;
}

/** Fastify `trustProxy` setting derived from the environment. */
export const trustProxy = parseTrustProxy(env.TRUST_PROXY);

/** Max bytes for one recording segment / library upload (see MAX_UPLOAD_MB). */
export const maxUploadBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

/** Allowed browser origins (web dashboard + camera app), comma-separated. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Whether to mark session cookies Secure (HTTPS-only). */
export const cookieSecure = env.COOKIE_SECURE
  ? env.COOKIE_SECURE === 'true'
  : env.NODE_ENV === 'production';

/** Outgoing mail is only attempted when an SMTP host is configured. */
export const mailEnabled = env.SMTP_HOST.length > 0;

/** TLS-on-connect (465) vs STARTTLS (587), explicit override via SMTP_SECURE. */
export const smtpSecure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465;

/** The From address for outgoing mail (falls back to the SMTP username). */
export const mailFrom = env.SMTP_FROM || env.SMTP_USER;

/** Public dashboard base URL without a trailing slash. */
export const appUrl = env.APP_URL.replace(/\/+$/, '');

import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_SIGNING_SECRET = 'dev-insecure-signing-secret-change-me';

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
  // Secret used to sign playback URLs. Override with a strong value in production.
  SIGNING_SECRET: z.string().min(1).default(DEFAULT_SIGNING_SECRET),
  // ffmpeg binary path. Empty = use the bundled @ffmpeg-installer binary.
  // Point this at a system/Docker ffmpeg when you have one.
  FFMPEG_PATH: z.string().default(''),
  // Send cookies only over HTTPS. Defaults to on in production. Set to 'false'
  // to test a production build over plain HTTP locally.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
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

/** Allowed browser origins (web dashboard + camera app), comma-separated. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Whether to mark session cookies Secure (HTTPS-only). */
export const cookieSecure = env.COOKIE_SECURE
  ? env.COOKIE_SECURE === 'true'
  : env.NODE_ENV === 'production';

import 'dotenv/config';
import { z } from 'zod';

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

/** Allowed browser origins (web dashboard + camera app), comma-separated. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

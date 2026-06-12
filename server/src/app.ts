import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOrigins, env, trustProxy } from './env.js';
import { HttpError } from './lib/errors.js';
import { registerAuth } from './auth/plugin.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/users.js';
import { deviceRoutes } from './routes/devices.js';
import { lessonRoutes } from './routes/lessons.js';
import { libraryRoutes } from './routes/library.js';
import { settingsRoutes } from './routes/settings.js';
import { holidayRoutes } from './routes/holidays.js';
import { roomRoutes } from './routes/rooms.js';
import { recordingRoutes } from './routes/recordings.js';
import { setupRealtime } from './realtime/io.js';

/**
 * Builds the Fastify app without starting it, so tests can drive it via
 * `app.inject()` without binding a port. `trustProxy` defaults to the env-derived
 * value; tests override it to exercise the X-Forwarded-For behaviour.
 */
export async function buildApp(
  options: { trustProxy?: boolean | number | string } = {},
) {
  const app = Fastify({
    trustProxy: options.trustProxy ?? trustProxy,
    logger:
      env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  // Security headers. CSP/COEP are disabled because this is a JSON+media API
  // (the SPAs are served separately and set their own policy); enabling them
  // here would only risk blocking video playback.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  // Plugins. Order matters: cookies must be parsed before auth reads them.
  await app.register(cors, { origin: corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await registerAuth(app);

  // Raw binary parser for recording chunk uploads (larger than the JSON limit).
  const bufferParserOpts = { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 } as const;
  const toBuffer = (_req: unknown, body: Buffer, done: (err: Error | null, body: Buffer) => void) =>
    done(null, body);
  app.addContentTypeParser('application/octet-stream', bufferParserOpts, toBuffer);
  // Also accept the media types a browser may put on a Blob upload body (iOS
  // Safari in particular), so a chunk is never rejected on its content-type.
  app.addContentTypeParser(/^(video|audio)\//, bufferParserOpts, toBuffer);

  // Single place to turn errors into clean JSON responses.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validatiefout', issues: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    // Fastify/plugin errors (validation, rate limit, ...) carry a statusCode.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Interne serverfout' });
  });

  // Realtime layer on the same HTTP server. Decorates app.io and app.presence,
  // so it must run BEFORE the routes that read them (Fastify only inherits
  // decorators that exist at the time a plugin is registered).
  setupRealtime(app);

  // Routes.
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(userRoutes);
  await app.register(deviceRoutes);
  await app.register(lessonRoutes);
  await app.register(libraryRoutes);
  await app.register(settingsRoutes);
  await app.register(holidayRoutes);
  await app.register(roomRoutes);
  await app.register(recordingRoutes);

  return app;
}

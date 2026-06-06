import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './env.js';
import { HttpError } from './lib/errors.js';
import { registerAuth } from './auth/plugin.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';

/**
 * Builds the Fastify app without starting it, so tests can drive it via
 * `app.inject()` without binding a port.
 */
export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  // Plugins. Order matters: cookies must be parsed before auth reads them.
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await registerAuth(app);

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

  // Routes.
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);

  return app;
}

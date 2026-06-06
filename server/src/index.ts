import Fastify from 'fastify';
import cors from '@fastify/cors';
import { APP_NAME, type HealthResponse } from '@practiceroom/shared';
import { env } from './env.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

app.get('/api/health', async (): Promise<HealthResponse> => {
  return {
    status: 'ok',
    app: APP_NAME,
    time: new Date().toISOString(),
  };
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

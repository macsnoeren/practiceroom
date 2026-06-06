import type { FastifyInstance } from 'fastify';
import { APP_NAME, type HealthResponse } from '@practiceroom/shared';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', app: APP_NAME, time: new Date().toISOString() };
  });

  // Proves the database is reachable (used during setup/monitoring).
  app.get('/api/health/db', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'reachable' };
  });
}

import type { FastifyInstance } from 'fastify';
import { CreateHolidaySchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { notFound } from '../lib/errors.js';
import { parseDateOnly } from '../lib/dates.js';
import { toHolidayDto } from '../lib/dto.js';

export async function holidayRoutes(app: FastifyInstance): Promise<void> {
  // Everyone in the school (incl. students) can see the holidays.
  app.get('/api/holidays', async (request) => {
    const me = requireAuth(request);
    const holidays = await prisma.holiday.findMany({
      where: { schoolId: me.schoolId },
      orderBy: { startsOn: 'asc' },
    });
    return holidays.map(toHolidayDto);
  });

  app.post('/api/holidays', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const input = CreateHolidaySchema.parse(request.body);
    const holiday = await prisma.holiday.create({
      data: {
        schoolId: me.schoolId,
        name: input.name,
        startsOn: parseDateOnly(input.startsOn),
        endsOn: parseDateOnly(input.endsOn),
      },
    });
    return reply.code(201).send(toHolidayDto(holiday));
  });

  app.delete('/api/holidays/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    const me = requireAuth(request);
    const { id } = request.params as { id: string };
    const result = await prisma.holiday.deleteMany({ where: { id, schoolId: me.schoolId } });
    if (result.count === 0) throw notFound('Vakantie niet gevonden');
    return reply.code(204).send();
  });
}

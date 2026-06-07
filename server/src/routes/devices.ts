import type { FastifyInstance } from 'fastify';
import { CreateDeviceSchema, PairDeviceSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { authenticateDevice } from '../auth/device.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { toDeviceDto } from '../lib/dto.js';
import {
  PAIRING_TTL_MS,
  generateDeviceToken,
  generatePairingCode,
  hashToken,
} from '../lib/device.js';
import { sensitiveRateLimit } from '../lib/rate-limit.js';

/** Generate a pairing code that is not currently in use. */
async function generateUniquePairingCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePairingCode();
    const clash = await prisma.device.findUnique({ where: { pairingCode: code } });
    if (!clash) return code;
  }
  throw new Error('Kon geen unieke koppelcode genereren');
}

interface DeviceParams {
  id: string;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  /* ---- Management (staff, cookie session) ---------------------------------- */

  app.post('/api/devices', { preHandler: requireRole('admin', 'teacher') }, async (request, reply) => {
    const me = requireAuth(request);
    const { name } = CreateDeviceSchema.parse(request.body);

    const pairingCode = await generateUniquePairingCode();
    const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    const device = await prisma.device.create({
      data: { schoolId: me.schoolId, name, pairingCode, pairingExpiresAt },
    });

    return reply.code(201).send({
      device: toDeviceDto(device),
      pairingCode,
      pairingExpiresAt: pairingExpiresAt.toISOString(),
    });
  });

  app.get('/api/devices', { preHandler: requireRole('admin', 'teacher') }, async (request) => {
    const me = requireAuth(request);
    const devices = await prisma.device.findMany({
      where: { schoolId: me.schoolId },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map(toDeviceDto);
  });

  // Regenerate a pairing code (e.g. after it expired). Only for unpaired devices.
  app.post(
    '/api/devices/:id/pairing-code',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as DeviceParams;

      const device = await prisma.device.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!device) throw notFound('Apparaat niet gevonden');

      const pairingCode = await generateUniquePairingCode();
      const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      await prisma.device.update({ where: { id }, data: { pairingCode, pairingExpiresAt } });

      return { pairingCode, pairingExpiresAt: pairingExpiresAt.toISOString() };
    },
  );

  // Revoke pairing: the device must pair again to be usable. Keeps the record.
  app.post(
    '/api/devices/:id/revoke',
    { preHandler: requireRole('admin', 'teacher') },
    async (request) => {
      const me = requireAuth(request);
      const { id } = request.params as DeviceParams;

      const device = await prisma.device.findFirst({ where: { id, schoolId: me.schoolId } });
      if (!device) throw notFound('Apparaat niet gevonden');

      const updated = await prisma.device.update({
        where: { id },
        data: { tokenHash: null, pairedAt: null, pairingCode: null, pairingExpiresAt: null },
      });
      return toDeviceDto(updated);
    },
  );

  app.delete(
    '/api/devices/:id',
    { preHandler: requireRole('admin', 'teacher') },
    async (request, reply) => {
      const me = requireAuth(request);
      const { id } = request.params as DeviceParams;

      const result = await prisma.device.deleteMany({ where: { id, schoolId: me.schoolId } });
      if (result.count === 0) throw notFound('Apparaat niet gevonden');
      return reply.code(204).send();
    },
  );

  /* ---- Camera app (device bearer token) ------------------------------------ */

  app.post('/api/devices/pair', sensitiveRateLimit, async (request, reply) => {
    const { pairingCode } = PairDeviceSchema.parse(request.body);

    const device = await prisma.device.findUnique({ where: { pairingCode } });
    if (!device || !device.pairingExpiresAt || device.pairingExpiresAt.getTime() < Date.now()) {
      throw unauthorized('Ongeldige of verlopen koppelcode');
    }

    const token = generateDeviceToken();
    await prisma.device.update({
      where: { id: device.id },
      data: {
        tokenHash: hashToken(token),
        pairedAt: new Date(),
        lastSeenAt: new Date(),
        pairingCode: null,
        pairingExpiresAt: null,
      },
    });

    return reply.code(200).send({ token, device: { id: device.id, name: device.name } });
  });

  app.get('/api/devices/me', async (request) => {
    const device = await authenticateDevice(request);
    return { id: device.id, name: device.name, schoolId: device.schoolId };
  });
}

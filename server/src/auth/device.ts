import type { Device } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { hashToken } from '../lib/device.js';

/**
 * Authenticates a camera device from its `Authorization: Bearer <token>`
 * header and refreshes `lastSeenAt`. Throws 401 if the token is missing or
 * unknown. This is separate from user (cookie) auth on purpose.
 */
export async function authenticateDevice(request: FastifyRequest): Promise<Device> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) throw unauthorized('Geen apparaat-token');

  const device = await prisma.device.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device) throw unauthorized('Ongeldig apparaat-token');

  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return device;
}

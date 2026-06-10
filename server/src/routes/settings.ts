import type { FastifyInstance } from 'fastify';
import { BrandingSlotSchema, UpdateSettingsSchema } from '@practiceroom/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/plugin.js';
import { badRequest } from '../lib/errors.js';
import { toSchoolSettingsDto } from '../lib/dto.js';
import {
  appendBrandingChunk,
  finalizeBranding,
  removeBranding,
  type BrandingSlot,
} from '../lib/storage.js';

async function settings(schoolId: string) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  return toSchoolSettingsDto(school);
}

function parseSlot(value: string): BrandingSlot {
  const parsed = BrandingSlotSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Onbekend onderdeel');
  return parsed.data;
}

/** School-wide branding for the combined lesson videos: an intro/outro clip and
 * an overlay watermark. Admin only. */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', { preHandler: requireRole('admin') }, async (request) => {
    const me = requireAuth(request);
    return settings(me.schoolId);
  });

  app.patch('/api/settings', { preHandler: requireRole('admin') }, async (request) => {
    const me = requireAuth(request);
    const input = UpdateSettingsSchema.parse(request.body);
    await prisma.school.update({
      where: { id: me.schoolId },
      data: { overlayText: input.overlayText?.trim() || null },
    });
    return settings(me.schoolId);
  });

  // Chunked upload of an intro/outro clip (index 0 starts fresh).
  app.post(
    '/api/settings/branding/:slot/chunks',
    { preHandler: requireRole('admin') },
    async (request) => {
      const me = requireAuth(request);
      const slot = parseSlot((request.params as { slot: string }).slot);
      const index = Number((request.query as { index?: string }).index);
      if (!Number.isInteger(index) || index < 0) throw badRequest('Ongeldige chunk-index');

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Lege chunk');

      await appendBrandingChunk(me.schoolId, slot, body, index);
      return { ok: true };
    },
  );

  app.post(
    '/api/settings/branding/:slot/complete',
    { preHandler: requireRole('admin') },
    async (request) => {
      const me = requireAuth(request);
      const slot = parseSlot((request.params as { slot: string }).slot);
      const mimeType = (request.query as { mimeType?: string }).mimeType ?? 'video/mp4';

      const size = await finalizeBranding(me.schoolId, slot);
      await prisma.school.update({
        where: { id: me.schoolId },
        data:
          slot === 'intro'
            ? { introMimeType: mimeType, introSizeBytes: size }
            : { outroMimeType: mimeType, outroSizeBytes: size },
      });
      return settings(me.schoolId);
    },
  );

  app.delete(
    '/api/settings/branding/:slot',
    { preHandler: requireRole('admin') },
    async (request) => {
      const me = requireAuth(request);
      const slot = parseSlot((request.params as { slot: string }).slot);
      await removeBranding(me.schoolId, slot);
      await prisma.school.update({
        where: { id: me.schoolId },
        data:
          slot === 'intro'
            ? { introMimeType: null, introSizeBytes: 0 }
            : { outroMimeType: null, outroSizeBytes: 0 },
      });
      return settings(me.schoolId);
    },
  );
}

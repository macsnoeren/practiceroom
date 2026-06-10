import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { createUser, login, registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

describe('school settings (branding)', () => {
  it('lets an admin set the watermark and upload/remove an intro; non-admins are blocked', async () => {
    const admin = await registerSchool(app, 'Set A', 'set-admin@example.com');
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'set-t@example.com',
      role: 'teacher',
    });
    const teacherCookie = await login(app, teacher.email);

    // Defaults are empty.
    const initial = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: admin.cookie },
    });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().overlayText, null);
    assert.equal(initial.json().intro, null);

    // Watermark text.
    const overlay = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { cookie: admin.cookie },
      payload: { overlayText: 'Niet verspreiden' },
    });
    assert.equal(overlay.json().overlayText, 'Niet verspreiden');

    // Upload an intro clip in one chunk, then complete it.
    await app.inject({
      method: 'POST',
      url: '/api/settings/branding/intro/chunks?index=0',
      headers: { cookie: admin.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('fake-intro-bytes'),
    });
    const done = await app.inject({
      method: 'POST',
      url: '/api/settings/branding/intro/complete?mimeType=video/webm',
      headers: { cookie: admin.cookie },
    });
    assert.equal(done.statusCode, 200);
    assert.ok(done.json().intro);
    assert.ok((done.json().intro.sizeBytes as number) > 0);

    // Remove it.
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/settings/branding/intro',
      headers: { cookie: admin.cookie },
    });
    assert.equal(removed.json().intro, null);

    // A teacher cannot read or change settings.
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/settings',
          headers: { cookie: teacherCookie },
        })
      ).statusCode,
      403,
    );
  });
});

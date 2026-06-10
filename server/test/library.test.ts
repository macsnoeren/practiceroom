import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { compositePath, ensureCompositeDir } from '../src/lib/storage.js';
import { createUser, login, registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

async function makeLesson(teacherCookie: string, studentId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/lessons',
    headers: { cookie: teacherCookie },
    payload: {
      studentId,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 30,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: string }).id;
}

describe('video library', () => {
  it('creates a link, attaches it to a lesson, and exposes it as material', async () => {
    const admin = await registerSchool(app, 'Lib A', 'lib-admin@example.com');
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'lib-t@example.com',
      role: 'teacher',
    });
    const student = await createUser(app, admin.cookie, {
      name: 'S',
      email: 'lib-s@example.com',
      role: 'student',
    });
    const teacherCookie = await login(app, teacher.email);

    const item = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: { cookie: teacherCookie },
      payload: { title: 'Toonladders', kind: 'link', url: 'https://example.com/v' },
    });
    assert.equal(item.statusCode, 201);
    const itemId = item.json().id as string;

    const lessonId = await makeLesson(teacherCookie, student.id);
    const attach = await app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/materials/from-library`,
      headers: { cookie: teacherCookie },
      payload: { libraryItemId: itemId },
    });
    assert.equal(attach.statusCode, 201);
    assert.equal(attach.json().library.kind, 'link');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}`,
      headers: { cookie: teacherCookie },
    });
    const mat = (detail.json().materials as { library: { kind: string } | null }[])[0];
    assert.equal(mat?.library?.kind, 'link');
  });

  it('uploads a file and streams it back; access is owner- or lesson-scoped', async () => {
    const admin = await registerSchool(app, 'Lib B', 'libb-admin@example.com');
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'libb-t@example.com',
      role: 'teacher',
    });
    const teacherB = await createUser(app, admin.cookie, {
      name: 'T2',
      email: 'libb-t2@example.com',
      role: 'teacher',
    });
    const student = await createUser(app, admin.cookie, {
      name: 'S',
      email: 'libb-s@example.com',
      role: 'student',
    });
    const teacherCookie = await login(app, teacher.email);
    const teacherBCookie = await login(app, teacherB.email);
    const studentCookie = await login(app, student.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: { cookie: teacherCookie },
      payload: { title: 'Demo', kind: 'file' },
    });
    const itemId = created.json().id as string;
    assert.equal(created.json().status, 'uploading');

    const chunk = await app.inject({
      method: 'POST',
      url: `/api/library/${itemId}/chunks?index=0`,
      headers: { cookie: teacherCookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('fake-video-bytes'),
    });
    assert.equal(chunk.statusCode, 200);
    const done = await app.inject({
      method: 'POST',
      url: `/api/library/${itemId}/complete?mimeType=video/webm`,
      headers: { cookie: teacherCookie },
    });
    assert.equal(done.json().status, 'ready');
    assert.ok((done.json().sizeBytes as number) > 0);

    // Owner can get a signed URL and stream it.
    const playback = await app.inject({
      method: 'GET',
      url: `/api/library/${itemId}/playback-url`,
      headers: { cookie: teacherCookie },
    });
    assert.equal(playback.statusCode, 200);
    const stream = await app.inject({
      method: 'GET',
      url: playback.json().url,
      headers: { cookie: teacherCookie },
    });
    assert.equal(stream.statusCode, 200);

    // Another teacher (not owner, not attached) is blocked.
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/library/${itemId}/playback-url`,
          headers: { cookie: teacherBCookie },
        })
      ).statusCode,
      403,
    );

    // Once attached to the student's lesson, the student may access it.
    const lessonId = await makeLesson(teacherCookie, student.id);
    await app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/materials/from-library`,
      headers: { cookie: teacherCookie },
      payload: { libraryItemId: itemId },
    });
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/library/${itemId}/playback-url`,
          headers: { cookie: studentCookie },
        })
      ).statusCode,
      200,
    );
  });

  it('saves a lesson composite into the library', async () => {
    const admin = await registerSchool(app, 'Lib C', 'libc-admin@example.com');
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'libc-t@example.com',
      role: 'teacher',
    });
    const student = await createUser(app, admin.cookie, {
      name: 'S',
      email: 'libc-s@example.com',
      role: 'student',
    });
    const teacherCookie = await login(app, teacher.email);
    const lessonId = await makeLesson(teacherCookie, student.id);

    await ensureCompositeDir(lessonId);
    await writeFile(compositePath(lessonId), Buffer.from('combined-video'));
    await prisma.compositeVideo.create({
      data: { lessonId, status: 'completed', sizeBytes: 14 },
    });

    const saved = await app.inject({
      method: 'POST',
      url: `/api/library/from-lesson/${lessonId}`,
      headers: { cookie: teacherCookie },
      payload: { title: 'Les van vandaag' },
    });
    assert.equal(saved.statusCode, 201);
    assert.equal(saved.json().kind, 'file');
    assert.ok((saved.json().sizeBytes as number) > 0);
  });
});

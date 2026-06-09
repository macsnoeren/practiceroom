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

describe('lesson tags (timeline markers)', () => {
  it('lets a teacher add, list and delete tags; a student cannot', async () => {
    const admin = await registerSchool(app, 'Tags A', 'tags-admin@example.com');
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'tags-t@example.com',
      role: 'teacher',
    });
    const student = await createUser(app, admin.cookie, {
      name: 'S',
      email: 'tags-s@example.com',
      role: 'student',
    });
    const teacherCookie = await login(app, teacher.email);
    const studentCookie = await login(app, student.email);
    const lessonId = await makeLesson(teacherCookie, student.id);

    const created = await app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/tags`,
      headers: { cookie: teacherCookie },
      payload: { label: 'mooi stuk' },
    });
    assert.equal(created.statusCode, 201);
    const tagId = created.json().id as string;
    assert.equal(created.json().label, 'mooi stuk');

    // It shows up in the lesson detail.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}`,
      headers: { cookie: teacherCookie },
    });
    assert.equal(detail.json().tags.length, 1);

    // A student may view but not tag.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/lessons/${lessonId}/tags`,
          headers: { cookie: studentCookie },
          payload: { label: 'nope' },
        })
      ).statusCode,
      403,
    );

    // Delete it.
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/lessons/${lessonId}/tags/${tagId}`,
          headers: { cookie: teacherCookie },
        })
      ).statusCode,
      204,
    );
    const after = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}`,
      headers: { cookie: teacherCookie },
    });
    assert.equal(after.json().tags.length, 0);
  });

  it('isolates tags across schools', async () => {
    const a = await registerSchool(app, 'Tags B', 'tagsb-admin@example.com');
    const teacherA = await createUser(app, a.cookie, {
      name: 'T',
      email: 'tagsb-t@example.com',
      role: 'teacher',
    });
    const studentA = await createUser(app, a.cookie, {
      name: 'S',
      email: 'tagsb-s@example.com',
      role: 'student',
    });
    const lessonId = await makeLesson(await login(app, teacherA.email), studentA.id);

    const b = await registerSchool(app, 'Tags C', 'tagsc-admin@example.com');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/lessons/${lessonId}/tags`,
          headers: { cookie: b.cookie },
          payload: { label: 'x' },
        })
      ).statusCode,
      404,
    );
  });
});

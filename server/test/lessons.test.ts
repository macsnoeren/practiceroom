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

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function createDevice(cookie: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { name },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { device: { id: string } }).device.id;
}

/** A school with an admin, one teacher and one student, all logged in. */
async function makeSchool(name: string, prefix: string) {
  const admin = await registerSchool(app, name, `${prefix}-admin@example.com`);
  const teacher = await createUser(app, admin.cookie, {
    name: 'Teacher',
    email: `${prefix}-teacher@example.com`,
    role: 'teacher',
  });
  const student = await createUser(app, admin.cookie, {
    name: 'Student',
    email: `${prefix}-student@example.com`,
    role: 'student',
  });
  return {
    adminCookie: admin.cookie,
    teacher: { ...teacher, cookie: await login(app, teacher.email) },
    student: { ...student, cookie: await login(app, student.email) },
  };
}

describe('lessons: planning, scoping and material', () => {
  it('lets a teacher plan a lesson and the student see only their own', async () => {
    const s = await makeSchool('Lesson A', 'la');
    const other = await createUser(app, s.adminCookie, {
      name: 'Student 2',
      email: 'la-student2@example.com',
      role: 'student',
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: s.teacher.cookie },
      payload: {
        studentId: s.student.id,
        title: 'Pianoles',
        startsAt: soon(),
        durationMinutes: 30,
      },
    });
    assert.equal(create.statusCode, 201, create.body);
    const lesson = create.json();
    assert.equal(lesson.teacher.id, s.teacher.id);
    assert.equal(lesson.student.id, s.student.id);
    assert.equal(lesson.status, 'planned');

    // The student sees their lesson.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/lessons',
      headers: { cookie: s.student.cookie },
    });
    assert.equal(mine.json().length, 1);

    // A different student sees none.
    const otherCookie = await login(app, other.email);
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/lessons',
      headers: { cookie: otherCookie },
    });
    assert.equal(theirs.json().length, 0);
  });

  it('rejects a non-student as the student and forbids students creating lessons', async () => {
    const s = await makeSchool('Lesson B', 'lb');

    const badStudent = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: s.teacher.cookie },
      payload: { studentId: s.teacher.id, startsAt: soon(), durationMinutes: 30 },
    });
    assert.equal(badStudent.statusCode, 400);

    const byStudent = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: s.student.cookie },
      payload: { studentId: s.student.id, startsAt: soon(), durationMinutes: 30 },
    });
    assert.equal(byStudent.statusCode, 403);
  });

  it('selects cameras and rejects devices from another school', async () => {
    const a = await makeSchool('Lesson C', 'lc');
    const b = await makeSchool('Lesson D', 'ld');

    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: a.teacher.cookie },
        payload: { studentId: a.student.id, startsAt: soon(), durationMinutes: 45 },
      })
    ).json();

    const cam1 = await createDevice(a.adminCookie, 'Cam 1');
    const cam2 = await createDevice(a.adminCookie, 'Cam 2');
    const foreignCam = await createDevice(b.adminCookie, 'Foreign');

    const ok = await app.inject({
      method: 'PUT',
      url: `/api/lessons/${lesson.id}/devices`,
      headers: { cookie: a.teacher.cookie },
      payload: { deviceIds: [cam1, cam2] },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().devices.length, 2);

    const foreign = await app.inject({
      method: 'PUT',
      url: `/api/lessons/${lesson.id}/devices`,
      headers: { cookie: a.teacher.cookie },
      payload: { deviceIds: [cam1, foreignCam] },
    });
    assert.equal(foreign.statusCode, 400);
  });

  it('adds material the student can read, and supports deletion', async () => {
    const s = await makeSchool('Lesson E', 'le');
    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: s.teacher.cookie },
        payload: { studentId: s.student.id, startsAt: soon(), durationMinutes: 30 },
      })
    ).json();

    const mat = await app.inject({
      method: 'POST',
      url: `/api/lessons/${lesson.id}/materials`,
      headers: { cookie: s.teacher.cookie },
      payload: { title: 'Bladmuziek', url: 'https://example.com/score.pdf' },
    });
    assert.equal(mat.statusCode, 201);
    const materialId = mat.json().id;

    // Student sees the material in the lesson detail.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: s.student.cookie },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().materials.length, 1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/lessons/${lesson.id}/materials/${materialId}`,
      headers: { cookie: s.teacher.cookie },
    });
    assert.equal(del.statusCode, 204);
  });

  it('keeps lessons isolated between schools and between teachers', async () => {
    const a = await makeSchool('Lesson F', 'lf');
    const b = await makeSchool('Lesson G', 'lg');
    const teacher2 = await createUser(app, a.adminCookie, {
      name: 'Teacher 2',
      email: 'lf-teacher2@example.com',
      role: 'teacher',
    });
    const teacher2Cookie = await login(app, teacher2.email);

    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: a.teacher.cookie },
        payload: { studentId: a.student.id, startsAt: soon(), durationMinutes: 30 },
      })
    ).json();

    // Another school cannot fetch it.
    const crossSchool = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: b.teacher.cookie },
    });
    assert.equal(crossSchool.statusCode, 404);

    // Another teacher in the same school may not manage it.
    const otherTeacherEdit = await app.inject({
      method: 'PATCH',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: teacher2Cookie },
      payload: { durationMinutes: 60 },
    });
    assert.equal(otherTeacherEdit.statusCode, 403);

    // The admin may.
    const adminEdit = await app.inject({
      method: 'PATCH',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: a.adminCookie },
      payload: { status: 'ready' },
    });
    assert.equal(adminEdit.statusCode, 200);
    assert.equal(adminEdit.json().status, 'ready');
  });

  it('lets an admin be the teacher of a lesson', async () => {
    const admin = await registerSchool(app, 'Admin Teaches', 'at-admin@example.com');
    const adminId = admin.body.user.id as string;
    const student = await createUser(app, admin.cookie, {
      name: 'Stud',
      email: 'at-student@example.com',
      role: 'student',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: admin.cookie },
      payload: {
        teacherId: adminId,
        studentId: student.id,
        startsAt: soon(),
        durationMinutes: 30,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().teacher.id, adminId);
  });

  it('rejects a student as the teacher', async () => {
    const s = await makeSchool('No Student Teacher', 'nst');
    const res = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: s.adminCookie },
      payload: {
        teacherId: s.student.id,
        studentId: s.student.id,
        startsAt: soon(),
        durationMinutes: 30,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects a javascript: material URL', async () => {
    const s = await makeSchool('Material XSS', 'mx');
    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: s.teacher.cookie },
        payload: { studentId: s.student.id, startsAt: soon(), durationMinutes: 30 },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/lessons/${lesson.id}/materials`,
      headers: { cookie: s.teacher.cookie },
      payload: { title: 'x', url: 'javascript:alert(document.cookie)' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('stores lesson notes', async () => {
    const s = await makeSchool('Notes', 'nt');
    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: s.teacher.cookie },
        payload: { studentId: s.student.id, startsAt: soon(), durationMinutes: 30 },
      })
    ).json();

    await app.inject({
      method: 'PATCH',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: s.teacher.cookie },
      payload: { notes: 'Mooi gespeeld, let op de timing.' },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/lessons/${lesson.id}`,
      headers: { cookie: s.teacher.cookie },
    });
    assert.equal(detail.json().notes, 'Mooi gespeeld, let op de timing.');
  });

  it('cannot start recording once the lesson is finished', async () => {
    const s = await makeSchool('Finished', 'fin');
    const lesson = (
      await app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: { cookie: s.teacher.cookie },
        payload: { studentId: s.student.id, startsAt: soon(), durationMinutes: 30 },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/api/lessons/${lesson.id}/recording/finish`,
      headers: { cookie: s.teacher.cookie },
    });

    // Status check runs before the camera/online checks, so any deviceId 400s.
    const start = await app.inject({
      method: 'POST',
      url: `/api/lessons/${lesson.id}/recording/start`,
      headers: { cookie: s.teacher.cookie },
      payload: { deviceId: 'whatever' },
    });
    assert.equal(start.statusCode, 400);
  });
});

describe('rooms', () => {
  function createRoom(cookie: string, name: string) {
    return app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { cookie },
      payload: { name },
    });
  }
  function listRooms(cookie: string) {
    return app.inject({ method: 'GET', url: '/api/rooms', headers: { cookie } });
  }

  it('lets an admin manage rooms that staff can list; isolated; non-admin blocked', async () => {
    const a = await makeSchool('Room A', 'ra');
    const b = await makeSchool('Room B', 'rb');

    assert.equal((await createRoom(a.adminCookie, 'Lokaal 1')).statusCode, 201);
    assert.equal((await listRooms(a.teacher.cookie)).json().length, 1);
    assert.equal((await listRooms(b.adminCookie)).json().length, 0);
    assert.equal((await createRoom(a.teacher.cookie, 'Nope')).statusCode, 403);
  });

  it('assigns a room to a lesson and rejects a room from another school', async () => {
    const a = await makeSchool('Room C', 'rc');
    const b = await makeSchool('Room D', 'rd');
    const room = (await createRoom(a.adminCookie, 'Zaal')).json() as { id: string };
    const foreign = (await createRoom(b.adminCookie, 'Vreemd')).json() as { id: string };

    const create = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: a.teacher.cookie },
      payload: { studentId: a.student.id, startsAt: soon(), durationMinutes: 30, roomId: room.id },
    });
    assert.equal(create.statusCode, 201, create.body);
    assert.equal(create.json().room.id, room.id);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: a.teacher.cookie },
      payload: {
        studentId: a.student.id,
        startsAt: soon(),
        durationMinutes: 30,
        roomId: foreign.id,
      },
    });
    assert.equal(bad.statusCode, 400);
  });
});

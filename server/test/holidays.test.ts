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

function createHoliday(cookie: string, body: { name: string; startsOn: string; endsOn: string }) {
  return app.inject({ method: 'POST', url: '/api/holidays', headers: { cookie }, payload: body });
}

function listHolidays(cookie: string) {
  return app.inject({ method: 'GET', url: '/api/holidays', headers: { cookie } });
}

describe('holidays', () => {
  it('lets an admin manage holidays that staff and students can see; isolated per school', async () => {
    const a = await makeSchool('Holiday A', 'ha');
    const b = await makeSchool('Holiday B', 'hb');

    const created = await createHoliday(a.adminCookie, {
      name: 'Herfstvakantie',
      startsOn: '2026-10-19',
      endsOn: '2026-10-23',
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().startsOn, '2026-10-19');

    // Teacher and student of school A see it.
    assert.equal((await listHolidays(a.teacher.cookie)).json().length, 1);
    assert.equal((await listHolidays(a.student.cookie)).json().length, 1);
    // School B sees none.
    assert.equal((await listHolidays(b.adminCookie)).json().length, 0);
  });

  it('forbids non-admins from creating holidays and validates the dates', async () => {
    const a = await makeSchool('Holiday Roles', 'hr');
    assert.equal(
      (
        await createHoliday(a.teacher.cookie, {
          name: 'X',
          startsOn: '2026-01-01',
          endsOn: '2026-01-02',
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await createHoliday(a.student.cookie, {
          name: 'X',
          startsOn: '2026-01-01',
          endsOn: '2026-01-02',
        })
      ).statusCode,
      403,
    );
    // End before start -> validation error.
    assert.equal(
      (
        await createHoliday(a.adminCookie, {
          name: 'X',
          startsOn: '2026-01-10',
          endsOn: '2026-01-05',
        })
      ).statusCode,
      400,
    );
  });
});

function planLesson(cookie: string, studentId: string, startsAt: string) {
  return app.inject({
    method: 'POST',
    url: '/api/lessons',
    headers: { cookie },
    payload: { studentId, startsAt, durationMinutes: 30 },
  });
}

function countLessons(cookie: string) {
  return app
    .inject({ method: 'GET', url: '/api/lessons', headers: { cookie } })
    .then((res) => (res.json() as unknown[]).length);
}

describe('holidays cancel lessons in the schedule', () => {
  it('hides a lesson when a covering holiday is added and restores it on removal', async () => {
    const a = await makeSchool('Cancel A', 'ca');
    const planned = await planLesson(a.teacher.cookie, a.student.id, '2026-12-25T10:00:00.000Z');
    assert.equal(planned.statusCode, 201);

    assert.equal(await countLessons(a.teacher.cookie), 1);
    assert.equal(await countLessons(a.student.cookie), 1);

    const holiday = await createHoliday(a.adminCookie, {
      name: 'Kerst',
      startsOn: '2026-12-24',
      endsOn: '2026-12-26',
    });
    const holidayId = holiday.json().id as string;

    // The lesson falls in the holiday -> it disappears from the schedule.
    assert.equal(await countLessons(a.teacher.cookie), 0);
    assert.equal(await countLessons(a.student.cookie), 0);

    // Removing the holiday brings it back (non-destructive).
    await app.inject({
      method: 'DELETE',
      url: `/api/holidays/${holidayId}`,
      headers: { cookie: a.adminCookie },
    });
    assert.equal(await countLessons(a.student.cookie), 1);
  });

  it('still lists a lapsed lesson with the holiday name when includeLapsed is set', async () => {
    const a = await makeSchool('Cancel Lapsed', 'clap');
    await planLesson(a.teacher.cookie, a.student.id, '2026-12-25T10:00:00.000Z');
    await createHoliday(a.adminCookie, {
      name: 'Kerstvakantie',
      startsOn: '2026-12-24',
      endsOn: '2026-12-26',
    });

    // Default: hidden for the student.
    assert.equal(await countLessons(a.student.cookie), 0);

    // With includeLapsed: returned, marked with the holiday name.
    const withLapsed = await app.inject({
      method: 'GET',
      url: '/api/lessons?student=me&includeLapsed=true',
      headers: { cookie: a.student.cookie },
    });
    const list = withLapsed.json() as { holidayName: string | null }[];
    assert.equal(list.length, 1);
    assert.equal(list[0]?.holidayName, 'Kerstvakantie');
  });

  it('rejects planning a single lesson on a holiday date', async () => {
    const a = await makeSchool('Cancel B', 'cb');
    await createHoliday(a.adminCookie, {
      name: 'Voorjaar',
      startsOn: '2027-02-22',
      endsOn: '2027-02-26',
    });
    const res = await planLesson(a.teacher.cookie, a.student.id, '2027-02-24T10:00:00.000Z');
    assert.equal(res.statusCode, 400);
  });
});

describe('weekly recurring lessons', () => {
  function planSeries(cookie: string, studentId: string, repeatWeeks: number) {
    return app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie },
      payload: {
        studentId,
        title: 'Wekelijkse les',
        startsAt: '2026-09-01T10:00:00.000Z',
        durationMinutes: 30,
        repeatWeeks,
      },
    });
  }

  it('plans a weekly series and skips weeks that fall in a holiday', async () => {
    const a = await makeSchool('Series A', 'sa');
    // Holiday covering the 3rd weekly occurrence (2026-09-15).
    await createHoliday(a.adminCookie, {
      name: 'Vakantie',
      startsOn: '2026-09-14',
      endsOn: '2026-09-16',
    });

    const res = await planSeries(a.teacher.cookie, a.student.id, 4);
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().seriesId, 'a series gets a seriesId');

    const lessons = (
      await app.inject({
        method: 'GET',
        url: '/api/lessons',
        headers: { cookie: a.teacher.cookie },
      })
    ).json() as { startsAt: string; seriesId: string | null }[];

    // 4 requested, 1 in a holiday -> 3 planned.
    assert.equal(lessons.length, 3);
    const days = lessons.map((l) => l.startsAt.slice(0, 10)).sort();
    assert.deepEqual(days, ['2026-09-01', '2026-09-08', '2026-09-22']);
    // All belong to the same series.
    assert.equal(new Set(lessons.map((l) => l.seriesId)).size, 1);
    assert.ok(lessons[0]!.seriesId);

    // The student sees the whole series.
    const studentLessons = (
      await app.inject({
        method: 'GET',
        url: '/api/lessons',
        headers: { cookie: a.student.cookie },
      })
    ).json();
    assert.equal(studentLessons.length, 3);
  });

  it('plans a single lesson without a series', async () => {
    const a = await makeSchool('Series B', 'sb');
    const res = await planSeries(a.teacher.cookie, a.student.id, 1);
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().seriesId, null);
  });

  it('can delete a whole series at once', async () => {
    const a = await makeSchool('Series C', 'sc');
    const created = await planSeries(a.teacher.cookie, a.student.id, 3);
    const lessonId = created.json().id as string;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/lessons/${lessonId}?series=true`,
      headers: { cookie: a.teacher.cookie },
    });
    assert.equal(del.statusCode, 204);

    const remaining = (
      await app.inject({
        method: 'GET',
        url: '/api/lessons',
        headers: { cookie: a.teacher.cookie },
      })
    ).json();
    assert.equal(remaining.length, 0);
  });
});

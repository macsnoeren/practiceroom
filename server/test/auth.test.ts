import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { registerSchool, sessionCookie, setupTestApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

async function createUser(
  cookie: string,
  user: { name: string; email: string; role: 'teacher' | 'student' },
) {
  return app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { ...user, password: 'supersecret' },
  });
}

describe('auth & tenant isolation', () => {
  it('registers a school with its admin and returns the admin user', async () => {
    const { cookie, body } = await registerSchool(app, 'Conservatorium A', 'admin-a@example.com');
    assert.equal(body.user.role, 'admin');
    assert.equal(body.user.email, 'admin-a@example.com');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().email, 'admin-a@example.com');
  });

  it('rejects a duplicate email on registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register-school',
      payload: {
        schoolName: 'Dup',
        adminName: 'Admin',
        email: 'admin-a@example.com',
        password: 'supersecret',
      },
    });
    assert.equal(res.statusCode, 409);
  });

  it('lets an admin create teachers/students and lists only its own school', async () => {
    // School A already exists from the first test (admin-a). Add staff.
    const a = await registerSchool(app, 'School A2', 'admin-a2@example.com');
    await createUser(a.cookie, {
      name: 'Teacher A',
      email: 'teacher-a@example.com',
      role: 'teacher',
    });
    await createUser(a.cookie, {
      name: 'Student A',
      email: 'student-a@example.com',
      role: 'student',
    });

    // A separate school B with its own student.
    const b = await registerSchool(app, 'School B', 'admin-b@example.com');
    await createUser(b.cookie, {
      name: 'Student B',
      email: 'student-b@example.com',
      role: 'student',
    });

    const listA = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: a.cookie },
    });
    const emailsA = listA.json().map((u: { email: string }) => u.email);
    assert.deepEqual(emailsA.sort(), [
      'admin-a2@example.com',
      'student-a@example.com',
      'teacher-a@example.com',
    ]);

    const listB = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: b.cookie },
    });
    const emailsB = listB.json().map((u: { email: string }) => u.email);
    // The crux: school B never sees school A's data.
    assert.deepEqual(emailsB.sort(), ['admin-b@example.com', 'student-b@example.com']);
    assert.ok(!emailsB.includes('teacher-a@example.com'));
  });

  it('lets a created teacher log in with correct credentials and rejects wrong ones', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'teacher-a@example.com', password: 'supersecret' },
    });
    assert.equal(ok.statusCode, 200);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'teacher-a@example.com', password: 'wrongpass' },
    });
    assert.equal(bad.statusCode, 401);
  });

  it('enforces authentication and roles on user management', async () => {
    // Unauthenticated.
    const anon = await app.inject({ method: 'GET', url: '/api/users' });
    assert.equal(anon.statusCode, 401);

    // A student may not list users (requires admin or teacher).
    const studentLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'student-a@example.com', password: 'supersecret' },
    });
    const studentCookie = sessionCookie(studentLogin.headers['set-cookie']);
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: studentCookie },
    });
    assert.equal(forbidden.statusCode, 403);
  });

  it('rejects invalid input with a 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register-school',
      payload: { schoolName: '', adminName: 'X', email: 'not-an-email', password: 'short' },
    });
    assert.equal(res.statusCode, 400);
  });
});

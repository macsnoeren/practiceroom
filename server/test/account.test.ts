import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
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

describe('admin user management', () => {
  it('edits, resets password and deletes users, with guards', async () => {
    const admin = await registerSchool(app, 'Acc A', 'acc-admin@example.com');
    const adminId = admin.body.user.id as string;
    const teacher = await createUser(app, admin.cookie, {
      name: 'T',
      email: 'acc-t@example.com',
      role: 'teacher',
    });

    // Edit name + role.
    const upd = await app.inject({
      method: 'PATCH',
      url: `/api/users/${teacher.id}`,
      headers: { cookie: admin.cookie },
      payload: { name: 'Nieuwe Naam', role: 'student' },
    });
    assert.equal(upd.statusCode, 200);
    assert.equal(upd.json().name, 'Nieuwe Naam');
    assert.equal(upd.json().role, 'student');

    // Reset password -> the user can log in with it.
    await app.inject({
      method: 'PATCH',
      url: `/api/users/${teacher.id}`,
      headers: { cookie: admin.cookie },
      payload: { password: 'resetpass123' },
    });
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'acc-t@example.com', password: 'resetpass123' },
    });
    assert.equal(relogin.statusCode, 200);

    // Admin cannot demote or delete themselves.
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${adminId}`,
          headers: { cookie: admin.cookie },
          payload: { role: 'teacher' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/users/${adminId}`,
          headers: { cookie: admin.cookie },
        })
      ).statusCode,
      400,
    );

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${teacher.id}`,
      headers: { cookie: admin.cookie },
    });
    assert.equal(del.statusCode, 204);
  });

  it('forbids non-admins and other schools', async () => {
    const a = await registerSchool(app, 'Acc B', 'accb-admin@example.com');
    const teacher = await createUser(app, a.cookie, {
      name: 'T',
      email: 'accb-t@example.com',
      role: 'teacher',
    });
    const teacherCookie = await login(app, teacher.email);
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${teacher.id}`,
          headers: { cookie: teacherCookie },
          payload: { name: 'x' },
        })
      ).statusCode,
      403,
    );

    const b = await registerSchool(app, 'Acc C', 'accc-admin@example.com');
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${teacher.id}`,
          headers: { cookie: b.cookie },
          payload: { name: 'x' },
        })
      ).statusCode,
      404,
    );
  });
});

describe('self profile', () => {
  it('updates name and changes password with the current one', async () => {
    const admin = await registerSchool(app, 'Prof A', 'prof-admin@example.com');
    const student = await createUser(app, admin.cookie, {
      name: 'S',
      email: 'prof-s@example.com',
      role: 'student',
    });
    const cookie = await login(app, student.email);

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie },
      payload: { name: 'Mijn Naam' },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().name, 'Mijn Naam');

    // New password without the current one -> rejected.
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/auth/me',
          headers: { cookie },
          payload: { newPassword: 'changedpass1' },
        })
      ).statusCode,
      400,
    );
    // Wrong current password -> rejected.
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/auth/me',
          headers: { cookie },
          payload: { currentPassword: 'wrong', newPassword: 'changedpass1' },
        })
      ).statusCode,
      401,
    );
    // Correct current password -> changed, and login works with the new one.
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/auth/me',
          headers: { cookie },
          payload: { currentPassword: 'supersecret', newPassword: 'changedpass1' },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'prof-s@example.com', password: 'changedpass1' },
        })
      ).statusCode,
      200,
    );
  });
});

describe('two-factor authentication', () => {
  it('sets up, enforces it at login, and disables', async () => {
    const admin = await registerSchool(app, '2FA A', 'tfa-admin@example.com');
    const cookie = admin.cookie;

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: { cookie },
    });
    assert.equal(setup.statusCode, 200);
    const secret = setup.json().secret as string;
    assert.ok((setup.json().otpauthUrl as string).startsWith('otpauth://'));

    // Wrong code does not enable.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/2fa/enable',
          headers: { cookie },
          payload: { code: '000000' },
        })
      ).statusCode,
      400,
    );
    // Correct code enables it.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/2fa/enable',
          headers: { cookie },
          payload: { code: authenticator.generate(secret) },
        })
      ).statusCode,
      200,
    );
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(me.json().totpEnabled, true);

    // Login now requires a code.
    const noCode = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'tfa-admin@example.com', password: 'supersecret' },
    });
    assert.equal(noCode.statusCode, 401);
    assert.equal(noCode.json().twofa, true);

    const withCode = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'tfa-admin@example.com',
        password: 'supersecret',
        code: authenticator.generate(secret),
      },
    });
    assert.equal(withCode.statusCode, 200);

    // Disable, then login works without a code again.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/2fa/disable',
          headers: { cookie },
          payload: { code: authenticator.generate(secret) },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'tfa-admin@example.com', password: 'supersecret' },
        })
      ).statusCode,
      200,
    );
  });
});

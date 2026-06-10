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

describe('site administration (superadmin)', () => {
  it('sets up once, enters a school, and manages users across schools', async () => {
    // No site admin yet.
    const status = await app.inject({ method: 'GET', url: '/api/admin/setup-status' });
    assert.equal(status.json().exists, false);

    // A normal school with its own admin.
    const school = await registerSchool(app, 'Site School', 'site-schooladmin@example.com');
    const schoolId = school.body.school.id as string;

    // Create the first site admin (logs in via the returned cookie).
    const setup = await app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      payload: { name: 'Site Admin', email: 'site@example.com', password: 'supersecret' },
    });
    assert.equal(setup.statusCode, 201, setup.body);
    assert.equal(setup.json().role, 'superadmin');
    assert.equal(setup.json().schoolId, null);
    assert.equal(setup.json().activeSchoolId, null);
    const superCookie = sessionCookie(setup.headers['set-cookie']);

    // Setup is one-time.
    const again = await app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      payload: { name: 'X', email: 'x@example.com', password: 'supersecret' },
    });
    assert.equal(again.statusCode, 403);

    // The site admin sees all schools.
    const schools = await app.inject({
      method: 'GET',
      url: '/api/admin/schools',
      headers: { cookie: superCookie },
    });
    assert.equal(schools.statusCode, 200);
    assert.ok((schools.json() as { id: string }[]).some((s) => s.id === schoolId));

    // The site admin can create a new (empty) school.
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/schools',
      headers: { cookie: superCookie },
      payload: { name: 'Nieuwe School' },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().name, 'Nieuwe School');
    assert.equal(created.json().userCount, 0);

    // Before entering a school, school-scoped routes are not available.
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: superCookie } }))
        .statusCode,
      401,
    );

    // Enter the school -> now acts as its admin.
    const enter = await app.inject({
      method: 'POST',
      url: '/api/admin/enter',
      headers: { cookie: superCookie },
      payload: { schoolId },
    });
    assert.equal(enter.statusCode, 200);
    assert.equal(enter.json().activeSchoolId, schoolId);

    const usersInSchool = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: superCookie },
    });
    assert.equal(usersInSchool.statusCode, 200);

    // Global user list spans schools and includes the site admin itself.
    const all = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: superCookie },
    });
    const list = all.json() as { id: string; role: string; schoolName: string | null }[];
    assert.ok(list.some((u) => u.role === 'superadmin'));
    assert.ok(list.some((u) => u.id === school.body.user.id && u.schoolName === 'Site School'));

    // Edit a school user globally.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${school.body.user.id}`,
      headers: { cookie: superCookie },
      payload: { name: 'Hernoemd' },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().name, 'Hernoemd');

    // Leave -> back to the site dashboard.
    const leave = await app.inject({
      method: 'POST',
      url: '/api/admin/leave',
      headers: { cookie: superCookie },
    });
    assert.equal(leave.json().activeSchoolId, null);
  });

  it('forbids non-superadmins from the admin area', async () => {
    const school = await registerSchool(app, 'Other School', 'other-admin@example.com');
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/schools',
          headers: { cookie: school.cookie },
        })
      ).statusCode,
      403,
    );
    // Setup is also blocked now that a site admin exists.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/setup',
          payload: { name: 'Y', email: 'y@example.com', password: 'supersecret' },
        })
      ).statusCode,
      403,
    );
  });
});

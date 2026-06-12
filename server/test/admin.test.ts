import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { login, registerSchool, sessionCookie, setupTestApp } from './helpers.js';
import { flushAudit } from '../src/lib/audit.js';

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

  it('exposes a searchable, paged audit log to the site admin only', async () => {
    // The earlier tests (registrations, logins, user edits) already produced
    // audit events; this login produces one more. Wait for the writes to settle.
    const superCookie = await login(app, 'site@example.com');
    const schoolAdmin = await registerSchool(app, 'Audit School', 'audit-admin@example.com');
    // A failed login records the attempted e-mail, giving us a searchable value.
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'audit-probe@example.com', password: 'wrong-password' },
    });
    await flushAudit();

    // Default page: newest first, with a total and pagination metadata.
    const first = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: { cookie: superCookie },
    });
    assert.equal(first.statusCode, 200);
    const body = first.json() as {
      items: { action: string; email: string | null }[];
      total: number;
      page: number;
      pageSize: number;
    };
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 50);
    assert.ok(body.total > 2, 'expected several audit events');
    assert.ok(body.items.some((e) => e.action === 'auth.login'));

    // Search narrows to matching rows (here: the failed login's e-mail).
    const searched = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?q=audit-probe@example.com',
      headers: { cookie: superCookie },
    });
    assert.equal(searched.statusCode, 200);
    const hits = searched.json() as { items: { action: string; email: string | null }[]; total: number };
    assert.ok(hits.total >= 1);
    assert.ok(hits.items.every((e) => e.email === 'audit-probe@example.com'));
    assert.ok(hits.items.some((e) => e.action === 'auth.login_failed'));

    // A search with no matches is empty.
    const none = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?q=zzz-no-such-event-zzz',
      headers: { cookie: superCookie },
    });
    assert.equal((none.json() as { total: number }).total, 0);

    // Pagination: a small page size returns at most that many, and page 2 differs.
    const page1 = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?pageSize=2&page=1',
      headers: { cookie: superCookie },
    });
    const page2 = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?pageSize=2&page=2',
      headers: { cookie: superCookie },
    });
    const p1 = page1.json() as { items: { id: string }[] };
    const p2 = page2.json() as { items: { id: string }[] };
    assert.ok(p1.items.length <= 2 && p1.items.length > 0);
    const overlap = p1.items.some((a) => p2.items.some((b) => b.id === a.id));
    assert.equal(overlap, false, 'pages should not overlap');

    // A school admin (non-superadmin) is forbidden.
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/audit-logs',
          headers: { cookie: schoolAdmin.cookie },
        })
      ).statusCode,
      403,
    );
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

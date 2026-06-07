import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let migrated = false;

/**
 * Builds a ready Fastify app against a clean test database. The schema is
 * applied once per process; rows are wiped before every suite so tests start
 * from a known state. Test files run serially (see the `test` script) so they
 * do not clobber each other's data.
 */
export async function setupTestApp(): Promise<FastifyInstance> {
  if (!migrated) {
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
    migrated = true;
  }
  await prisma.session.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();

  const app = await buildApp();
  await app.ready();
  return app;
}

/** Extract the session cookie value from a Set-Cookie response header. */
export function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
  const match = /pr_session=([^;]+)/.exec(header);
  assert.ok(match, 'expected a pr_session cookie to be set');
  return `pr_session=${match[1]}`;
}

export async function registerSchool(
  app: FastifyInstance,
  schoolName: string,
  email: string,
  password = 'supersecret',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register-school',
    payload: { schoolName, adminName: 'Admin', email, password },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { cookie: sessionCookie(res.headers['set-cookie']), body: res.json() };
}

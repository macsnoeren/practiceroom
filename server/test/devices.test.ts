import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

async function createDevice(cookie: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { name },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { device: { id: string; paired: boolean }; pairingCode: string };
}

async function pair(pairingCode: string) {
  return app.inject({ method: 'POST', url: '/api/devices/pair', payload: { pairingCode } });
}

describe('devices: registration, pairing and isolation', () => {
  it('creates an unpaired device with a pairing code', async () => {
    const a = await registerSchool(app, 'School A', 'a@example.com');
    const { device, pairingCode } = await createDevice(a.cookie, 'Lokaal 1');

    assert.equal(device.paired, false);
    assert.match(pairingCode, /^[A-Z0-9]{6}$/);

    const list = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { cookie: a.cookie },
    });
    assert.equal(list.json().length, 1);
  });

  it('pairs with the code, then authenticates with the bearer token', async () => {
    const a = await registerSchool(app, 'School Pair', 'pair@example.com');
    const { device, pairingCode } = await createDevice(a.cookie, 'Camera');

    const paired = await pair(pairingCode);
    assert.equal(paired.statusCode, 200);
    const token = paired.json().token as string;
    assert.ok(token.length > 20);

    const me = await app.inject({
      method: 'GET',
      url: '/api/devices/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().id, device.id);

    // The dashboard now shows it as paired.
    const list = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { cookie: a.cookie },
    });
    assert.equal(list.json()[0].paired, true);
  });

  it('rejects a wrong code and a code that was already used', async () => {
    const a = await registerSchool(app, 'School Codes', 'codes@example.com');
    const { pairingCode } = await createDevice(a.cookie, 'Cam');

    assert.equal((await pair('ZZZZZZ')).statusCode, 401);

    assert.equal((await pair(pairingCode)).statusCode, 200);
    // Code is consumed on success.
    assert.equal((await pair(pairingCode)).statusCode, 401);
  });

  it('rejects device requests without/with an invalid token', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/devices/me' })).statusCode, 401);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/devices/me',
      headers: { authorization: 'Bearer nope' },
    });
    assert.equal(bad.statusCode, 401);
  });

  it('revokes a pairing so the token stops working', async () => {
    const a = await registerSchool(app, 'School Revoke', 'revoke@example.com');
    const { device, pairingCode } = await createDevice(a.cookie, 'Cam');
    const token = (await pair(pairingCode)).json().token as string;

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/devices/${device.id}/revoke`,
      headers: { cookie: a.cookie },
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().paired, false);

    const me = await app.inject({
      method: 'GET',
      url: '/api/devices/me',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 401);
  });

  it('keeps devices isolated between schools', async () => {
    const a = await registerSchool(app, 'Isol A', 'isol-a@example.com');
    const b = await registerSchool(app, 'Isol B', 'isol-b@example.com');
    const { device: deviceA } = await createDevice(a.cookie, 'A-cam');

    // B sees only its own (zero) devices.
    const listB = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { cookie: b.cookie },
    });
    assert.equal(listB.json().length, 0);

    // B cannot delete A's device (scoped lookup -> 404).
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${deviceA.id}`,
      headers: { cookie: b.cookie },
    });
    assert.equal(del.statusCode, 404);
  });

  it('does not let students manage devices', async () => {
    const a = await registerSchool(app, 'School Roles', 'roles@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: a.cookie },
      payload: {
        name: 'Stud',
        email: 'stud@example.com',
        password: 'supersecret',
        role: 'student',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'stud@example.com', password: 'supersecret' },
    });
    const cookie = /pr_session=[^;]+/.exec(String(login.headers['set-cookie']))?.[0] ?? '';

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { name: 'Nope' },
    });
    assert.equal(res.statusCode, 403);
  });
});

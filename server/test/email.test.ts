import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { outbox } from '../src/lib/mailer.js';
import { createUser, registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  outbox.length = 0;
});

/** Pull the `?token=...` value out of the most recent mail sent to `to`. */
function tokenSentTo(to: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === to);
  assert.ok(mail, `expected an e-mail to ${to}`);
  const match = /token=([^\s&"]+)/.exec(mail.text);
  assert.ok(match, 'expected a token link in the e-mail');
  return decodeURIComponent(match[1]);
}

describe('e-mail verification', () => {
  it('is sent on registration and confirms the address', async () => {
    const admin = await registerSchool(app, 'Mail A', 'mail-admin@example.com');
    assert.equal(admin.body.user.emailVerified, false);

    const token = tokenSentTo('mail-admin@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    assert.equal(res.statusCode, 200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: admin.cookie },
    });
    assert.equal(me.json().emailVerified, true);

    // The token cannot be used twice.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    assert.equal(reuse.statusCode, 400);
  });

  it('rejects an unknown token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: 'does-not-exist' },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('password reset', () => {
  it('mails a link and lets the user set a new password', async () => {
    const admin = await registerSchool(app, 'Reset A', 'reset-admin@example.com');
    void admin;
    outbox.length = 0;

    const forgot = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'reset-admin@example.com' },
    });
    assert.equal(forgot.statusCode, 200);

    const token = tokenSentTo('reset-admin@example.com');
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'brandnewpass1' },
    });
    assert.equal(reset.statusCode, 200);

    // New password works; old one no longer does.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'reset-admin@example.com', password: 'brandnewpass1' },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'reset-admin@example.com', password: 'supersecret' },
        })
      ).statusCode,
      401,
    );
  });

  it('does not reveal whether an e-mail exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(outbox.length, 0);
  });
});

describe('invitations', () => {
  it('invites a user who then sets a password and logs in', async () => {
    const admin = await registerSchool(app, 'Invite A', 'invite-admin@example.com');
    outbox.length = 0;

    // Create without a password -> an invite is sent, login impossible yet.
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin.cookie },
      payload: { name: 'Nieuw', email: 'invitee@example.com', role: 'student' },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().emailVerified, false);

    const token = tokenSentTo('invitee@example.com');

    // Preview shows who the invite is for.
    const preview = await app.inject({
      method: 'GET',
      url: `/api/auth/invite?token=${encodeURIComponent(token)}`,
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().email, 'invitee@example.com');

    // Accept it -> password set, verified, and logged in (session cookie).
    const accept = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: { token, password: 'chosenpass123' },
    });
    assert.equal(accept.statusCode, 200);
    assert.equal(accept.json().emailVerified, true);
    assert.ok(accept.headers['set-cookie']);

    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'invitee@example.com', password: 'chosenpass123' },
        })
      ).statusCode,
      200,
    );

    // The invite token is single-use.
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/accept-invite',
          payload: { token, password: 'chosenpass123' },
        })
      ).statusCode,
      400,
    );

    void created;
  });

  it('still allows creating a user with an explicit password', async () => {
    const admin = await registerSchool(app, 'Invite B', 'inviteb-admin@example.com');
    const user = await createUser(app, admin.cookie, {
      name: 'Direct',
      email: 'direct@example.com',
      role: 'teacher',
    });
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: user.email, password: 'supersecret' },
        })
      ).statusCode,
      200,
    );
  });
});

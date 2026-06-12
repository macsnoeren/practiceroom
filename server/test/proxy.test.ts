import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { parseTrustProxy } from '../src/env.js';
import { prisma } from '../src/db.js';

describe('parseTrustProxy', () => {
  it('interprets the common env values', () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy(''), false);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy(' 2 '), 2);
    assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
  });
});

describe('proxy IP handling', () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it('reads X-Forwarded-For only when the proxy is trusted', async () => {
    // Trusting one hop: the (forwarded) client IP is used.
    const trusting = await buildApp({ trustProxy: 1 });
    trusting.get('/__ip', async (req) => ({ ip: req.ip }));
    await trusting.ready();
    const forwarded = await trusting.inject({
      method: 'GET',
      url: '/__ip',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    assert.equal(forwarded.json().ip, '203.0.113.7');
    await trusting.close();

    // Not trusting: the header is ignored and the socket IP stands.
    const direct = await buildApp({ trustProxy: false });
    direct.get('/__ip', async (req) => ({ ip: req.ip }));
    await direct.ready();
    const ignored = await direct.inject({
      method: 'GET',
      url: '/__ip',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    assert.notEqual(ignored.json().ip, '203.0.113.7');
    await direct.close();
  });
});

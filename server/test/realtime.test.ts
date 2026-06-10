import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@practiceroom/shared';
import { prisma } from '../src/db.js';
import { registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;
let baseUrl: string;
const sockets: Socket[] = [];

before(async () => {
  app = await setupTestApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const socket of sockets) socket.close();
  if (app) await app.close();
  await prisma.$disconnect();
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function track(socket: Socket): Socket {
  sockets.push(socket);
  return socket;
}

function connectStaff(cookie: string): Socket {
  return track(
    ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    }),
  );
}

function connectDevice(token: string): Socket {
  return track(
    ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { deviceToken: token },
    }),
  );
}

function waitConnect(socket: Socket, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), ms);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitEvent<T = unknown>(socket: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function createPairedDevice(cookie: string, name: string) {
  const create = await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { name },
  });
  const body = create.json() as { device: { id: string }; pairingCode: string };
  const pair = await app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { pairingCode: body.pairingCode },
  });
  return { id: body.device.id, token: (pair.json() as { token: string }).token };
}

describe('realtime: presence and command routing', () => {
  it('rejects an unauthenticated connection', async () => {
    const anon = track(ioClient(baseUrl, { transports: ['websocket'], reconnection: false }));
    await assert.rejects(waitConnect(anon), /unauthorized|timeout/);
  });

  it('notifies staff when a device comes online and goes offline', async () => {
    const a = await registerSchool(app, 'RT A', 'rt-a@example.com');
    const device = await createPairedDevice(a.cookie, 'Cam A');

    const staff = connectStaff(a.cookie);
    // Register the snapshot listener before connecting; the server emits it
    // immediately on connection and Socket.IO does not buffer unhandled events.
    const snapshotPromise = waitEvent(staff, SOCKET_EVENTS.presenceSnapshot);
    await waitConnect(staff);
    await snapshotPromise;

    const onlinePromise = waitEvent<{ deviceId: string }>(staff, SOCKET_EVENTS.deviceOnline);
    const cam = connectDevice(device.token);
    await waitConnect(cam);
    const onlineMsg = await onlinePromise;
    assert.equal(onlineMsg.deviceId, device.id);

    const offlinePromise = waitEvent<{ deviceId: string }>(staff, SOCKET_EVENTS.deviceOffline);
    cam.close();
    const offlineMsg = await offlinePromise;
    assert.equal(offlineMsg.deviceId, device.id);
  });

  it('includes already-online devices in the snapshot for late-joining staff', async () => {
    const a = await registerSchool(app, 'RT Snap', 'rt-snap@example.com');
    const device = await createPairedDevice(a.cookie, 'Cam Snap');

    const cam = connectDevice(device.token);
    await waitConnect(cam);
    await delay(50);

    const staff = connectStaff(a.cookie);
    const snapshotPromise = waitEvent<{ devices: { deviceId: string }[] }>(
      staff,
      SOCKET_EVENTS.presenceSnapshot,
    );
    await waitConnect(staff);
    const snapshot = await snapshotPromise;
    assert.ok(snapshot.devices.some((d) => d.deviceId === device.id));
  });

  it('relays a camera preview snapshot to staff (and rejects a non-image)', async () => {
    const a = await registerSchool(app, 'RT Frame', 'rt-frame@example.com');
    const device = await createPairedDevice(a.cookie, 'Cam Frame');

    const staff = connectStaff(a.cookie);
    await waitConnect(staff);
    const cam = connectDevice(device.token);
    await waitConnect(cam);

    const framePromise = waitEvent<{ deviceId: string; dataUrl: string }>(
      staff,
      SOCKET_EVENTS.cameraFrame,
    );
    // A bogus non-image payload must be dropped, the real one relayed.
    cam.emit(SOCKET_EVENTS.cameraFrame, { dataUrl: 'javascript:alert(1)' });
    cam.emit(SOCKET_EVENTS.cameraFrame, { dataUrl: 'data:image/jpeg;base64,AAAA' });
    const frame = await framePromise;
    assert.equal(frame.deviceId, device.id);
    assert.equal(frame.dataUrl, 'data:image/jpeg;base64,AAAA');
  });

  it('relays a mic gain command to the camera and the camera report back to staff', async () => {
    const a = await registerSchool(app, 'RT Gain', 'rt-gain@example.com');
    const device = await createPairedDevice(a.cookie, 'Cam Gain');

    const staff = connectStaff(a.cookie);
    await waitConnect(staff);
    const cam = connectDevice(device.token);
    await waitConnect(cam);
    await delay(50); // let the device be marked online

    // staff -> device
    const command = waitEvent<{ gain: number }>(cam, SOCKET_EVENTS.micSetGain);
    staff.emit(SOCKET_EVENTS.micSetGain, { deviceId: device.id, gain: 1.5 });
    assert.equal((await command).gain, 1.5);

    // device -> staff
    const report = waitEvent<{ deviceId: string; gain: number }>(staff, SOCKET_EVENTS.micGain);
    cam.emit(SOCKET_EVENTS.micGain, { gain: 0.25 });
    const r = await report;
    assert.equal(r.deviceId, device.id);
    assert.equal(r.gain, 0.25);

    // a live mic level is also relayed to staff (the sound test)
    const levelPromise = waitEvent<{ deviceId: string; level: number }>(
      staff,
      SOCKET_EVENTS.micLevel,
    );
    cam.emit(SOCKET_EVENTS.micLevel, { level: 0.6 });
    const lvl = await levelPromise;
    assert.equal(lvl.deviceId, device.id);
    assert.equal(lvl.level, 0.6);
  });
});

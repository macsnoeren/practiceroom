import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@practiceroom/shared';
import { prisma } from '../src/db.js';
import { recordingPath } from '../src/lib/storage.js';
import { createUser, login, registerSchool, setupTestApp } from './helpers.js';

let app: FastifyInstance;
let baseUrl: string;
const sockets: Socket[] = [];

before(async () => {
  app = await setupTestApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const socket of sockets) socket.close();
  if (app) await app.close();
  await prisma.$disconnect();
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function connectDevice(token: string): Socket {
  const socket = ioClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    auth: { deviceToken: token },
  });
  sockets.push(socket);
  return socket;
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

async function pairedDevice(cookie: string, name: string) {
  const create = await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { name },
  });
  const deviceId = (create.json() as { device: { id: string } }).device.id;
  const pair = await app.inject({
    method: 'POST',
    url: '/api/devices/pair',
    payload: { pairingCode: (create.json() as { pairingCode: string }).pairingCode },
  });
  return { id: deviceId, token: (pair.json() as { token: string }).token };
}

/** A school with a lesson whose only camera is the returned (paired) device. */
async function lessonSetup(prefix: string) {
  const admin = await registerSchool(app, `Rec ${prefix}`, `${prefix}-admin@example.com`);
  const teacher = await createUser(app, admin.cookie, {
    name: 'T',
    email: `${prefix}-t@example.com`,
    role: 'teacher',
  });
  const student = await createUser(app, admin.cookie, {
    name: 'S',
    email: `${prefix}-s@example.com`,
    role: 'student',
  });
  const teacherCookie = await login(app, teacher.email);
  const device = await pairedDevice(admin.cookie, 'Cam');

  const lesson = (
    await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: teacherCookie },
      payload: {
        studentId: student.id,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        durationMinutes: 30,
      },
    })
  ).json() as { id: string };

  await app.inject({
    method: 'PUT',
    url: `/api/lessons/${lesson.id}/devices`,
    headers: { cookie: teacherCookie },
    payload: { deviceIds: [device.id] },
  });

  return { adminCookie: admin.cookie, teacherCookie, lessonId: lesson.id, device };
}

function uploadChunk(recordingId: string, token: string, index: number, data: Buffer) {
  return app.inject({
    method: 'POST',
    url: `/api/recordings/${recordingId}/chunks?index=${index}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    payload: data,
  });
}

describe('recordings: chunked upload and lifecycle', () => {
  it('appends ordered chunks, resumes, validates the file and completes the lesson', async () => {
    const s = await lessonSetup('up');
    const recording = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'recording' },
    });
    const chunks = [Buffer.from('AAAA'), Buffer.from('BB'), Buffer.from('CCCCCC')];

    assert.equal((await uploadChunk(recording.id, s.device.token, 0, chunks[0]!)).statusCode, 200);
    assert.equal((await uploadChunk(recording.id, s.device.token, 1, chunks[1]!)).statusCode, 200);

    // Resume info reflects what the server has.
    const resume = await app.inject({
      method: 'GET',
      url: `/api/recordings/${recording.id}`,
      headers: { authorization: `Bearer ${s.device.token}` },
    });
    assert.equal(resume.json().receivedChunks, 2);

    // A gap is rejected with the expected index.
    const gap = await uploadChunk(recording.id, s.device.token, 5, Buffer.from('X'));
    assert.equal(gap.statusCode, 409);
    assert.equal(gap.json().expected, 2);

    // A duplicate (already-stored index) is a no-op.
    const dup = await uploadChunk(recording.id, s.device.token, 0, chunks[0]!);
    assert.equal(dup.statusCode, 200);
    assert.equal(dup.json().received, 2);

    assert.equal((await uploadChunk(recording.id, s.device.token, 2, chunks[2]!)).statusCode, 200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/recordings/${recording.id}/complete?mimeType=video/webm`,
      headers: { authorization: `Bearer ${s.device.token}` },
    });
    assert.equal(complete.statusCode, 200);
    assert.equal(complete.json().status, 'completed');

    // The file on disk is exactly the chunks concatenated, in order.
    const file = await readFile(recordingPath(recording.id));
    assert.deepEqual(file, Buffer.concat(chunks));

    // The lesson is now "recorded" (its only recording is done).
    const lesson = await prisma.lesson.findUnique({ where: { id: s.lessonId } });
    assert.equal(lesson?.status, 'recorded');
  });

  it('rejects chunks from a different device', async () => {
    const s = await lessonSetup('auth');
    const recording = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'recording' },
    });
    const intruder = await pairedDevice(s.adminCookie, 'Intruder');

    const res = await uploadChunk(recording.id, intruder.token, 0, Buffer.from('hack'));
    assert.equal(res.statusCode, 404);
  });

  it('starts recording only when a camera is online, and commands it', async () => {
    const s = await lessonSetup('start');

    // No camera connected yet -> cannot start.
    const offline = await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/start`,
      headers: { cookie: s.teacherCookie },
    });
    assert.equal(offline.statusCode, 400);

    // Bring the camera online over the websocket.
    const cam = connectDevice(s.device.token);
    await waitConnect(cam);
    await delay(50);

    const startMsg = waitEvent<{ recordingId: string; lessonId: string }>(
      cam,
      SOCKET_EVENTS.recordingStart,
    );
    const start = await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/start`,
      headers: { cookie: s.teacherCookie },
    });
    assert.equal(start.statusCode, 201);
    const received = await startMsg;
    assert.equal(received.lessonId, s.lessonId);
    assert.equal(start.json()[0].id, received.recordingId);

    const lesson = await prisma.lesson.findUnique({ where: { id: s.lessonId } });
    assert.equal(lesson?.status, 'recording');

    // Stopping commands the camera to stop.
    const stopMsg = waitEvent<{ recordingId: string }>(cam, SOCKET_EVENTS.recordingStop);
    const stop = await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/stop`,
      headers: { cookie: s.teacherCookie },
    });
    assert.equal(stop.statusCode, 200);
    assert.equal((await stopMsg).recordingId, received.recordingId);
  });
});

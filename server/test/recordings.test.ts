import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@practiceroom/shared';
import { prisma } from '../src/db.js';
import { recordingPath } from '../src/lib/storage.js';
import { signPlayback } from '../src/lib/signing.js';
import { maxUploadBytes } from '../src/env.js';
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
  });

  it('stores a valid crop rectangle on completion and ignores an invalid one', async () => {
    const s = await lessonSetup('crop');

    const cropped = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'recording' },
    });
    await uploadChunk(cropped.id, s.device.token, 0, Buffer.from('AAAA'));
    const ok = await app.inject({
      method: 'POST',
      url: `/api/recordings/${cropped.id}/complete?cropX=0.1&cropY=0.2&cropW=0.5&cropH=0.6`,
      headers: { authorization: `Bearer ${s.device.token}` },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json().crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 });

    // A rectangle that runs off the frame is rejected and left unset.
    const bad = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'recording' },
    });
    await uploadChunk(bad.id, s.device.token, 0, Buffer.from('AAAA'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/recordings/${bad.id}/complete?cropX=0.8&cropY=0&cropW=0.5&cropH=0.5`,
      headers: { authorization: `Bearer ${s.device.token}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().crop, null);
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

    // Camera not connected yet -> cannot start.
    const offline = await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/start`,
      headers: { cookie: s.teacherCookie },
      payload: { deviceId: s.device.id },
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
      payload: { deviceId: s.device.id },
    });
    assert.equal(start.statusCode, 201);
    const received = await startMsg;
    assert.equal(received.lessonId, s.lessonId);
    assert.equal(start.json().id, received.recordingId);

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

  it('records one camera at a time: starting another stops the first', async () => {
    const s = await lessonSetup('switch');
    const dev2 = await pairedDevice(s.adminCookie, 'Cam 2');
    await app.inject({
      method: 'PUT',
      url: `/api/lessons/${s.lessonId}/devices`,
      headers: { cookie: s.teacherCookie },
      payload: { deviceIds: [s.device.id, dev2.id] },
    });

    const cam1 = connectDevice(s.device.token);
    const cam2 = connectDevice(dev2.token);
    await Promise.all([waitConnect(cam1), waitConnect(cam2)]);
    await delay(50);

    const start1 = waitEvent(cam1, SOCKET_EVENTS.recordingStart);
    await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/start`,
      headers: { cookie: s.teacherCookie },
      payload: { deviceId: s.device.id },
    });
    await start1;

    // Switch to camera 2: camera 1 gets stop, camera 2 gets start.
    const cam1Stop = waitEvent(cam1, SOCKET_EVENTS.recordingStop);
    const cam2Start = waitEvent(cam2, SOCKET_EVENTS.recordingStart);
    await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/start`,
      headers: { cookie: s.teacherCookie },
      payload: { deviceId: dev2.id },
    });
    await cam1Stop;
    await cam2Start;

    const recs = await prisma.recording.findMany({ where: { lessonId: s.lessonId } });
    assert.equal(recs.length, 2);
  });

  it('finishing queues the composite and marks the lesson recorded', async () => {
    const s = await lessonSetup('finish');
    await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'completed' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/lessons/${s.lessonId}/recording/finish`,
      headers: { cookie: s.teacherCookie },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'queued');

    const lesson = await prisma.lesson.findUnique({ where: { id: s.lessonId } });
    assert.equal(lesson?.status, 'recorded');
    const composite = await prisma.compositeVideo.findUnique({ where: { lessonId: s.lessonId } });
    assert.equal(composite?.status, 'queued');
  });
});

async function completedRecording(
  deviceToken: string,
  lessonId: string,
  deviceId: string,
  bytes: Buffer,
) {
  const recording = await prisma.recording.create({
    data: { lessonId, deviceId, status: 'recording' },
  });
  await uploadChunk(recording.id, deviceToken, 0, bytes);
  await app.inject({
    method: 'POST',
    url: `/api/recordings/${recording.id}/complete`,
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  return recording.id;
}

describe('recordings: upload size cap', () => {
  it('rejects a chunk that would exceed the size limit, writing nothing', async () => {
    const s = await lessonSetup('cap');
    const rec = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'recording' },
    });
    // Pretend the segment is already at the limit, then push one more byte.
    await prisma.recording.update({ where: { id: rec.id }, data: { sizeBytes: maxUploadBytes } });

    const res = await uploadChunk(rec.id, s.device.token, 0, Buffer.from('X'));
    assert.equal(res.statusCode, 413);

    // The chunk was not accepted (counter unchanged, nothing appended).
    const after = await prisma.recording.findUnique({ where: { id: rec.id } });
    assert.equal(after?.receivedChunks, 0);
  });
});

describe('recordings: signed playback', () => {
  it('streams a completed recording to a participant via a signed URL', async () => {
    const s = await lessonSetup('play');
    const studentCookie = await login(app, 'play-s@example.com');
    const bytes = Buffer.from('VIDEO-DATA-0123456789');
    const recId = await completedRecording(s.device.token, s.lessonId, s.device.id, bytes);

    const urlRes = await app.inject({
      method: 'GET',
      url: `/api/recordings/${recId}/playback-url`,
      headers: { cookie: studentCookie },
    });
    assert.equal(urlRes.statusCode, 200);
    const url = urlRes.json().url as string;

    const full = await app.inject({ method: 'GET', url, headers: { cookie: studentCookie } });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.rawPayload, bytes);

    // Range request returns just the requested slice.
    const ranged = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: studentCookie, range: 'bytes=0-4' },
    });
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.headers['content-range'], `bytes 0-4/${bytes.length}`);
    assert.deepEqual(ranged.rawPayload, bytes.subarray(0, 5));
  });

  it('blocks a copied link for a non-participant and rejects bad/expired signatures', async () => {
    const s = await lessonSetup('play2');
    // Another student in the SAME school, not part of this lesson.
    const outsider = await createUser(app, s.adminCookie, {
      name: 'Other',
      email: 'play2-outsider@example.com',
      role: 'student',
    });
    const outsiderCookie = await login(app, outsider.email);

    const recId = await completedRecording(
      s.device.token,
      s.lessonId,
      s.device.id,
      Buffer.from('secret-video'),
    );
    const url = (
      await app.inject({
        method: 'GET',
        url: `/api/recordings/${recId}/playback-url`,
        headers: { cookie: s.teacherCookie },
      })
    ).json().url as string;

    // A non-participant cannot even get a URL...
    const denied = await app.inject({
      method: 'GET',
      url: `/api/recordings/${recId}/playback-url`,
      headers: { cookie: outsiderCookie },
    });
    assert.equal(denied.statusCode, 403);

    // ...and a copied (valid) link does not work for them either.
    const copied = await app.inject({ method: 'GET', url, headers: { cookie: outsiderCookie } });
    assert.equal(copied.statusCode, 403);

    // Anonymous (no session) is unauthorized even with a valid signature.
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);

    // Tampered signature -> forbidden, even for the teacher.
    const tampered = url.replace(/sig=.+$/, 'sig=deadbeef');
    assert.equal(
      (await app.inject({ method: 'GET', url: tampered, headers: { cookie: s.teacherCookie } }))
        .statusCode,
      403,
    );

    // Expired signature -> forbidden.
    const past = Date.now() - 1000;
    const expiredUrl = `/api/recordings/${recId}/stream?expires=${past}&sig=${signPlayback(recId, past)}`;
    assert.equal(
      (await app.inject({ method: 'GET', url: expiredUrl, headers: { cookie: s.teacherCookie } }))
        .statusCode,
      403,
    );
  });
});

describe('recordings: deleting segments', () => {
  it('lets a teacher delete a segment and rebuilds (or removes) the combined video', async () => {
    const s = await lessonSetup('del');
    const studentCookie = await login(app, 'del-s@example.com');

    const recA = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'completed' },
    });
    const recB = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.device.id, status: 'completed' },
    });
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'completed' } });

    // A student may not delete segments.
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/recordings/${recA.id}`,
          headers: { cookie: studentCookie },
        })
      ).statusCode,
      403,
    );

    // Deleting one segment requeues the combined video for a rebuild.
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/recordings/${recA.id}`,
          headers: { cookie: s.teacherCookie },
        })
      ).statusCode,
      204,
    );
    assert.equal(await prisma.recording.count({ where: { lessonId: s.lessonId } }), 1);
    assert.equal(
      (await prisma.compositeVideo.findUnique({ where: { lessonId: s.lessonId } }))?.status,
      'queued',
    );

    // Deleting the last segment removes the combined video entirely.
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/recordings/${recB.id}`,
          headers: { cookie: s.teacherCookie },
        })
      ).statusCode,
      204,
    );
    assert.equal(await prisma.compositeVideo.findUnique({ where: { lessonId: s.lessonId } }), null);
  });
});

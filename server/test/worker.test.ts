import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {
  buildBlackVideoArgs,
  buildConcatArgs,
  buildSilentAudioArgs,
} from '../src/lib/composite.js';
import { processQueuedJob } from '../src/worker/runner.js';
import { prisma } from '../src/db.js';
import { compositePath, recordingPath } from '../src/lib/storage.js';
import { createUser, login, registerSchool, setupTestApp } from './helpers.js';

const execFileP = promisify(execFile);
let app: FastifyInstance;

before(async () => {
  app = await setupTestApp();
});

after(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
});

/** Generate a tiny real webm (video + audio) as a stand-in camera segment. */
async function genWebm(path: string, size: string, freq: number) {
  await mkdir(dirname(path), { recursive: true });
  await execFileP(ffmpeg.path, [
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=1:size=${size}:rate=15`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:duration=1`,
    '-c:v',
    'libvpx',
    '-c:a',
    'libopus',
    '-shortest',
    '-y',
    path,
  ]);
}

/** An audio-only webm (no video stream). */
async function genAudioWebm(path: string, freq: number) {
  await mkdir(dirname(path), { recursive: true });
  await execFileP(ffmpeg.path, [
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:duration=1`,
    '-c:a',
    'libopus',
    '-y',
    path,
  ]);
}

/** A video-only webm (no audio stream). */
async function genVideoWebm(path: string, size: string) {
  await mkdir(dirname(path), { recursive: true });
  await execFileP(ffmpeg.path, [
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=1:size=${size}:rate=15`,
    '-c:v',
    'libvpx',
    '-y',
    path,
  ]);
}

async function setup(prefix: string) {
  const admin = await registerSchool(app, `W ${prefix}`, `${prefix}-admin@example.com`);
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
  const dev = (
    await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie: admin.cookie },
      payload: { name: 'Cam' },
    })
  ).json() as { device: { id: string } };
  const lesson = (
    await app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: { cookie: teacherCookie },
      payload: {
        studentId: student.id,
        startsAt: new Date(Date.now() + 36e5).toISOString(),
        durationMinutes: 30,
      },
    })
  ).json() as { id: string };
  return { adminCookie: admin.cookie, teacherCookie, deviceId: dev.device.id, lessonId: lesson.id };
}

describe('worker: composite video', () => {
  it('builds ffmpeg concat args (pure)', () => {
    const args = buildConcatArgs(['a.webm', 'b.webm'], 'out.mp4');
    assert.ok(args.includes('-filter_complex'));
    assert.ok(args.join(' ').includes('concat=n=2:v=1:a=1'));
    assert.equal(args.at(-1), 'out.mp4');
    assert.throws(() => buildConcatArgs([], 'out.mp4'));
  });

  it('builds args to pad audio-only and video-only segments (pure)', () => {
    const black = buildBlackVideoArgs('audio.webm', 'fixed.webm');
    assert.ok(black.join(' ').includes('color=c=black'));
    assert.ok(black.includes('-shortest'));
    assert.equal(black.at(-1), 'fixed.webm');

    const silent = buildSilentAudioArgs('video.webm', 'fixed.webm');
    assert.ok(silent.join(' ').includes('anullsrc'));
    assert.ok(silent.includes('-shortest'));
  });

  it('composites a mix of camera, audio-only and silent-camera segments', async () => {
    const s = await setup('mixed');
    const both = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        hasVideo: true,
        hasAudio: true,
        startedAt: new Date(Date.now() - 3000),
      },
    });
    const audioOnly = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        hasVideo: false,
        hasAudio: true,
        startedAt: new Date(Date.now() - 2000),
      },
    });
    const videoOnly = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        hasVideo: true,
        hasAudio: false,
        startedAt: new Date(Date.now() - 1000),
      },
    });
    await genWebm(recordingPath(both.id), '320x240', 440);
    await genAudioWebm(recordingPath(audioOnly.id), 550);
    await genVideoWebm(recordingPath(videoOnly.id), '640x480');
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'queued' } });

    assert.equal(await processQueuedJob(), 'done');
    assert.ok((await stat(compositePath(s.lessonId))).size > 0);
    assert.equal((await prisma.lesson.findUnique({ where: { id: s.lessonId } }))?.status, 'ready');
  });

  it('concatenates segments (different sizes) into one playable lesson video', async () => {
    const s = await setup('concat');
    const recA = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        startedAt: new Date(Date.now() - 2000),
      },
    });
    const recB = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        startedAt: new Date(Date.now() - 1000),
      },
    });
    await genWebm(recordingPath(recA.id), '320x240', 440);
    await genWebm(recordingPath(recB.id), '640x480', 660);
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'queued' } });

    assert.equal(await processQueuedJob(), 'done');

    assert.ok((await stat(compositePath(s.lessonId))).size > 0);
    assert.equal(
      (await prisma.compositeVideo.findUnique({ where: { lessonId: s.lessonId } }))?.status,
      'completed',
    );
    assert.equal((await prisma.lesson.findUnique({ where: { id: s.lessonId } }))?.status, 'ready');

    // The combined video plays back for a participant via a signed URL.
    const url = (
      await app.inject({
        method: 'GET',
        url: `/api/lessons/${s.lessonId}/composite/playback-url`,
        headers: { cookie: s.teacherCookie },
      })
    ).json().url as string;
    const stream = await app.inject({ method: 'GET', url, headers: { cookie: s.teacherCookie } });
    assert.equal(stream.statusCode, 200);
    assert.equal(stream.headers['content-type'], 'video/mp4');
  });

  it('waits while a segment is still uploading', async () => {
    const s = await setup('waiting');
    // One completed, one still "recording" (uploading).
    await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.deviceId, status: 'completed' },
    });
    await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.deviceId, status: 'recording' },
    });
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'queued' } });

    assert.equal(await processQueuedJob(), 'waiting');
    // Job is back in the queue for a later attempt.
    assert.equal(
      (await prisma.compositeVideo.findUnique({ where: { lessonId: s.lessonId } }))?.status,
      'queued',
    );
  });
});

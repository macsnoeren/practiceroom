import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {
  buildBlackVideoArgs,
  buildCanonicalExternalArgs,
  buildConcatArgs,
  buildSilentAudioArgs,
} from '../src/lib/composite.js';
import { processQueuedJob, runFfmpeg } from '../src/worker/runner.js';
import { prisma } from '../src/db.js';
import { brandingPath, compositePath, recordingPath } from '../src/lib/storage.js';
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

  it('builds a watermark filter and canonicalises external clips (pure)', () => {
    const withOverlay = buildConcatArgs(['a.webm'], 'out.mp4', {
      overlay: { text: 'Niet verspreiden', fontPath: '/font.ttf' },
    });
    assert.ok(withOverlay.join(' ').includes('drawtext='));
    assert.ok(withOverlay.join(' ').includes("text='Niet verspreiden'"));

    const both = buildCanonicalExternalArgs('intro.mp4', 'out.mp4', true, true);
    assert.ok(both.includes('-vf'));
    const noAudio = buildCanonicalExternalArgs('intro.mp4', 'out.mp4', true, false);
    assert.ok(noAudio.join(' ').includes('anullsrc'));
    const noVideo = buildCanonicalExternalArgs('audio.m4a', 'out.mp4', false, true);
    assert.ok(noVideo.join(' ').includes('color=c=black'));
  });

  it('prepends a crop filter for cropped segments only (pure)', () => {
    const args = buildConcatArgs(['a.webm', 'b.webm'], 'out.mp4', {
      crops: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, null],
    });
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    assert.ok(fc.includes('[0:v]crop=iw*0.5:ih*0.6:iw*0.1:ih*0.2,scale='));
    // The second (uncropped) input goes straight to scale, with no crop.
    assert.ok(fc.includes('[1:v]scale='));
    assert.ok(!fc.includes('[1:v]crop='));
    // An out-of-range rectangle is ignored rather than producing a bad filter.
    const bad = buildConcatArgs(['a.webm'], 'out.mp4', {
      crops: [{ x: 0.8, y: 0, w: 0.5, h: 0.5 }],
    });
    assert.ok(!bad.join(' ').includes('crop='));
  });

  it('composites a segment that has a crop rectangle', async () => {
    const s = await setup('crop');
    const rec = await prisma.recording.create({
      data: {
        lessonId: s.lessonId,
        deviceId: s.deviceId,
        status: 'completed',
        cropX: 0.25,
        cropY: 0.1,
        cropW: 0.5,
        cropH: 0.5,
      },
    });
    await genWebm(recordingPath(rec.id), '640x480', 440);
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'queued' } });

    assert.equal(await processQueuedJob(), 'done');
    assert.ok((await stat(compositePath(s.lessonId))).size > 0);
  });

  it('burns in the watermark text when a system font is available', async (t) => {
    const fonts = [
      'C:/Windows/Fonts/arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/Library/Fonts/Arial.ttf',
    ];
    let fontPath: string | null = null;
    for (const f of fonts) {
      try {
        await access(f);
        fontPath = f;
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!fontPath) {
      t.skip('no system font available for drawtext');
      return;
    }

    const input = recordingPath(randomUUID());
    const output = compositePath(randomUUID());
    await genWebm(input, '320x240', 440);
    await mkdir(dirname(output), { recursive: true });
    // Must not throw: drawtext with a real font + inline text.
    await runFfmpeg(
      buildConcatArgs([input], output, {
        overlay: { text: "Niet verspreiden — eigendom van 't huis", fontPath },
      }),
    );
    assert.ok((await stat(output)).size > 0);
  });

  it('prepends an intro and appends an outro to the lesson video', async () => {
    const s = await setup('branding');
    const schoolId = (await prisma.lesson.findUniqueOrThrow({ where: { id: s.lessonId } }))
      .schoolId;

    const rec = await prisma.recording.create({
      data: { lessonId: s.lessonId, deviceId: s.deviceId, status: 'completed' },
    });
    await genWebm(recordingPath(rec.id), '320x240', 440);
    // Branding files are stored extensionless (raw uploaded bytes), so generate
    // a .webm first and copy it into place.
    await genWebm(`${brandingPath(schoolId, 'intro')}.webm`, '640x480', 330);
    await copyFile(`${brandingPath(schoolId, 'intro')}.webm`, brandingPath(schoolId, 'intro'));
    await genWebm(`${brandingPath(schoolId, 'outro')}.webm`, '640x480', 550);
    await copyFile(`${brandingPath(schoolId, 'outro')}.webm`, brandingPath(schoolId, 'outro'));
    await prisma.school.update({
      where: { id: schoolId },
      data: { introMimeType: 'video/webm', outroMimeType: 'video/webm' },
    });
    await prisma.compositeVideo.create({ data: { lessonId: s.lessonId, status: 'queued' } });

    assert.equal(await processQueuedJob(), 'done');
    assert.ok((await stat(compositePath(s.lessonId))).size > 0);
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

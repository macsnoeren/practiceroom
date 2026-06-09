import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { buildBlackVideoArgs, buildConcatArgs, buildSilentAudioArgs } from '../lib/composite.js';
import type { Recording } from '@prisma/client';
import {
  compositePath,
  compositeSize,
  ensureCompositeDir,
  normalizedSegmentPath,
  recordingPath,
  removeFile,
} from '../lib/storage.js';

export type JobResult = 'idle' | 'done' | 'waiting' | 'failed';

function ffmpegPath(): string {
  return env.FFMPEG_PATH || ffmpegInstaller.path;
}

/** Runs ffmpeg, resolving on success and rejecting with stderr on failure. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg afgesloten met code ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Returns a path to a segment that is guaranteed to have both a video and an
 * audio stream. A recording captured with both is used as-is; an audio-only or
 * video-only one is rewritten into a temp file (recorded in `temps` for
 * cleanup) with the missing stream synthesised.
 */
async function normalizeSegment(
  lessonId: string,
  recording: Recording,
  temps: string[],
): Promise<string> {
  const src = recordingPath(recording.id);
  if (recording.hasVideo && recording.hasAudio) return src;
  if (!recording.hasVideo && !recording.hasAudio) return src; // nothing to pad

  const fixed = normalizedSegmentPath(lessonId, recording.id);
  if (!recording.hasVideo) {
    await runFfmpeg(buildBlackVideoArgs(src, fixed));
  } else {
    await runFfmpeg(buildSilentAudioArgs(src, fixed));
  }
  temps.push(fixed);
  return fixed;
}

/**
 * Claims one queued composite job and processes it: concatenate the lesson's
 * completed recording segments (in time order) into one video. If segments are
 * still uploading, the job is returned to the queue to retry later.
 */
export async function processQueuedJob(): Promise<JobResult> {
  const job = await prisma.compositeVideo.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
  });
  if (!job) return 'idle';

  // Atomically claim it; if another worker took it first, count is 0.
  const claim = await prisma.compositeVideo.updateMany({
    where: { id: job.id, status: 'queued' },
    data: { status: 'processing' },
  });
  if (claim.count === 0) return 'idle';

  try {
    const recordings = await prisma.recording.findMany({
      where: { lessonId: job.lessonId },
      orderBy: { startedAt: 'asc' },
    });

    if (recordings.some((r) => r.status === 'recording')) {
      // A segment is still uploading; requeue and try again on the next tick.
      await prisma.compositeVideo.update({ where: { id: job.id }, data: { status: 'queued' } });
      return 'waiting';
    }

    const completed = recordings.filter((r) => r.status === 'completed');
    if (completed.length === 0) {
      await prisma.compositeVideo.update({
        where: { id: job.id },
        data: { status: 'failed', error: 'Geen voltooide opnames om samen te voegen' },
      });
      return 'failed';
    }

    await ensureCompositeDir(job.lessonId);
    const output = compositePath(job.lessonId);

    // The concat step expects every segment to have both a video and an audio
    // stream. Segments captured as audio-only or video-without-sound are first
    // padded with a black frame / silent track so they stitch in cleanly.
    const temps: string[] = [];
    try {
      const inputs = await Promise.all(
        completed.map((r) => normalizeSegment(job.lessonId, r, temps)),
      );
      await runFfmpeg(buildConcatArgs(inputs, output));
    } finally {
      for (const temp of temps) await removeFile(temp);
    }

    await prisma.compositeVideo.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        sizeBytes: await compositeSize(job.lessonId),
        completedAt: new Date(),
        error: null,
      },
    });
    await prisma.lesson.update({ where: { id: job.lessonId }, data: { status: 'ready' } });
    return 'done';
  } catch (err) {
    await prisma.compositeVideo.update({
      where: { id: job.id },
      data: { status: 'failed', error: String(err).slice(0, 500) },
    });
    return 'failed';
  }
}

/** Poll the queue forever, processing composite jobs as they appear. */
export async function runWorkerLoop(intervalMs = 3000): Promise<void> {
  for (;;) {
    let result: JobResult = 'idle';
    try {
      result = await processQueuedJob();
    } catch (err) {
      console.error('[worker] onverwachte fout:', err);
    }
    // After finishing a job, look for more immediately; otherwise wait a bit.
    if (result === 'done') continue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

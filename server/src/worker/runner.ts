import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  buildBlackVideoArgs,
  buildCanonicalExternalArgs,
  buildConcatArgs,
  buildSilentAudioArgs,
} from '../lib/composite.js';
import { probeStreams } from '../lib/probe.js';
import type { Recording } from '@prisma/client';
import {
  brandingExists,
  brandingPath,
  compositePath,
  compositeSize,
  ensureCompositeDir,
  normalizedBrandingPath,
  normalizedSegmentPath,
  overlayTextPath,
  recordingPath,
  removeFile,
  type BrandingSlot,
} from '../lib/storage.js';

export type JobResult = 'idle' | 'done' | 'waiting' | 'failed';

// Bundled default intro/outro clips, used when a school has not set its own.
// Resolved relative to this module so it works in dev (src) and in the built
// image (dist); both sit two levels under server/, next to assets/.
const DEFAULT_BRANDING: Record<BrandingSlot, string> = {
  intro: fileURLToPath(new URL('../../assets/branding/intro.mkv', import.meta.url)),
  outro: fileURLToPath(new URL('../../assets/branding/outro.mkv', import.meta.url)),
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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
 * Returns a canonicalised intro/outro clip path for a school, or null when none
 * is set. The clip is re-encoded to match the composite (and gains a black
 * frame / silence if it lacks one), recorded in `temps` for cleanup.
 */
async function brandingInput(
  school: { id: string; introMimeType: string | null; outroMimeType: string | null } | null,
  slot: BrandingSlot,
  lessonId: string,
  temps: string[],
): Promise<string | null> {
  // Use the school's own clip when set, otherwise the bundled default.
  let src: string | null = null;
  const mime = slot === 'intro' ? school?.introMimeType : school?.outroMimeType;
  if (school && mime && (await brandingExists(school.id, slot))) {
    src = brandingPath(school.id, slot);
  } else if (await fileExists(DEFAULT_BRANDING[slot])) {
    src = DEFAULT_BRANDING[slot];
  }
  if (!src) return null;

  const { hasVideo, hasAudio } = await probeStreams(src);
  if (!hasVideo && !hasAudio) return null;
  const out = normalizedBrandingPath(lessonId, slot);
  await runFfmpeg(buildCanonicalExternalArgs(src, out, hasVideo, hasAudio));
  temps.push(out);
  return out;
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

    // School branding: optional intro before / outro after, and a watermark.
    const school = await prisma.school.findFirst({
      where: { lessons: { some: { id: job.lessonId } } },
    });

    // The concat step expects every segment to have both a video and an audio
    // stream. Segments captured as audio-only or video-without-sound are first
    // padded with a black frame / silent track so they stitch in cleanly.
    const temps: string[] = [];
    try {
      const lessonInputs = await Promise.all(
        completed.map((r) => normalizeSegment(job.lessonId, r, temps)),
      );
      const inputs: string[] = [];
      const intro = await brandingInput(school, 'intro', job.lessonId, temps);
      if (intro) inputs.push(intro);
      inputs.push(...lessonInputs);
      const outro = await brandingInput(school, 'outro', job.lessonId, temps);
      if (outro) inputs.push(outro);

      // Optional "do not distribute" watermark (only when a font is configured).
      let overlay: { textFile: string; fontPath: string } | undefined;
      const overlayText = school?.overlayText?.trim();
      if (overlayText && env.FONT_PATH) {
        const textFile = overlayTextPath(job.lessonId);
        await writeFile(textFile, overlayText, 'utf8');
        temps.push(textFile);
        overlay = { textFile, fontPath: env.FONT_PATH };
      }

      try {
        await runFfmpeg(buildConcatArgs(inputs, output, overlay ? { overlay } : {}));
      } catch (err) {
        // Never fail the whole video over a watermark/font issue: retry plain.
        if (!overlay) throw err;
        console.warn('[worker] overlay mislukt, opnieuw zonder watermerk:', err);
        await runFfmpeg(buildConcatArgs(inputs, output));
      }
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

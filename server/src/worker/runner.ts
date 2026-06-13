import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  buildBlackVideoArgs,
  buildCanonicalExternalArgs,
  buildConcatArgs,
  buildMuxVideoOverAudioArgs,
  buildPipCompositeArgs,
  buildSilentAudioArgs,
  type CropRect,
  type PipInput,
} from '../lib/composite.js';
import { probeDuration, probeStreams } from '../lib/probe.js';
import type { Recording } from '@prisma/client';
import {
  brandingExists,
  brandingPath,
  composedSegmentPath,
  compositePath,
  compositeSize,
  ensureCompositeDir,
  normalizedBrandingPath,
  normalizedSegmentPath,
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

/** The crop rectangle stored on a recording, or null when none was chosen. */
function recordingCrop(r: Recording): CropRect | null {
  if (r.cropX === null || r.cropY === null || r.cropW === null || r.cropH === null) return null;
  return { x: r.cropX, y: r.cropY, w: r.cropW, h: r.cropH };
}

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

/** One concat input: the segment file on disk and its optional crop rectangle. */
interface SegmentInput {
  path: string;
  crop: CropRect | null;
}

/**
 * Turns a lesson's completed recordings into the ordered list of segment inputs
 * for the concat step. Recordings started together (a camera + the room's audio
 * source) share a `segmentGroupId`: for such a group the camera's video is muxed
 * with the audio source's sound, so the same microphone sits under every camera.
 * Recordings without a group are their own single segment (unchanged behaviour).
 * A lone audio-track recording (its camera partner was deleted/failed) is
 * auxiliary and skipped.
 */
async function buildLessonSegments(
  lessonId: string,
  completed: Recording[],
  temps: string[],
): Promise<SegmentInput[]> {
  const groups = new Map<string, Recording[]>();
  for (const r of completed) {
    const key = r.segmentGroupId ?? `solo:${r.id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const ordered: { startedAt: number; input: SegmentInput }[] = [];
  for (const members of groups.values()) {
    const audioRec = members.find((r) => r.isAudioTrack) ?? null;
    const videoMembers = members.filter((r) => !r.isAudioTrack);
    if (videoMembers.length === 0) continue; // lone audio track: auxiliary

    // The full-frame camera, plus any picture-in-picture insets (composed source).
    const main = videoMembers.find((r) => r.layoutRole === 'main') ?? videoMembers[0]!;
    const pips = videoMembers.filter((r) => r.layoutRole === 'pip' && r.hasVideo);

    let path: string;
    let crop: CropRect | null;
    if (pips.length > 0 && main.hasVideo) {
      // Composed source: overlay the insets onto the main camera, with the audio
      // source's sound (when present) laid under the result.
      //
      // The member cameras begin a little apart (per-device warm-up) but stop
      // together, so align by the END: each file's duration tells how much earlier
      // it started, and we fast-seek that much off its front so every layer covers
      // the same common window. Only done when all durations are known.
      const mainPath = recordingPath(main.id);
      const pipPaths = pips.map((p) => recordingPath(p.id));
      const audioPath = audioRec ? recordingPath(audioRec.id) : null;
      const allPaths = [mainPath, ...pipPaths, ...(audioPath ? [audioPath] : [])];
      const durations = await Promise.all(allPaths.map((p) => probeDuration(p)));
      const known = durations.every((d) => d > 0);
      const minD = known ? Math.min(...durations) : 0;
      const skip = (idx: number) => (known ? Math.max(0, durations[idx]! - minD) : 0);

      path = composedSegmentPath(lessonId, main.id);
      await runFfmpeg(
        buildPipCompositeArgs(
          { input: mainPath, skip: skip(0) },
          pips.map((p, i) => ({
            input: pipPaths[i]!,
            position: (p.layoutPosition ?? 'bottom-right') as PipInput['position'],
            scale: p.layoutScale ?? 0.28,
            skip: skip(1 + i),
          })),
          audioPath ? { input: audioPath, skip: skip(1 + pips.length) } : null,
          path,
        ),
      );
      temps.push(path);
      crop = null; // a crop does not apply to a composed frame
    } else if (audioRec && main.hasVideo) {
      // Single camera with the audio source's sound laid under it.
      path = normalizedSegmentPath(lessonId, main.id);
      await runFfmpeg(
        buildMuxVideoOverAudioArgs(recordingPath(main.id), recordingPath(audioRec.id), path),
      );
      temps.push(path);
      crop = recordingCrop(main);
    } else {
      path = await normalizeSegment(lessonId, main, temps);
      crop = recordingCrop(main);
    }
    ordered.push({ startedAt: main.startedAt.getTime(), input: { path, crop } });
  }

  ordered.sort((a, b) => a.startedAt - b.startedAt);
  return ordered.map((o) => o.input);
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
      const lessonSegments = await buildLessonSegments(job.lessonId, completed, temps);
      if (lessonSegments.length === 0) {
        await prisma.compositeVideo.update({
          where: { id: job.id },
          data: { status: 'failed', error: 'Geen bruikbare videosegmenten om samen te voegen' },
        });
        return 'failed';
      }
      // Crops are aligned by input index; intro/outro clips are never cropped.
      const inputs: string[] = [];
      const crops: (CropRect | null)[] = [];
      const intro = await brandingInput(school, 'intro', job.lessonId, temps);
      if (intro) {
        inputs.push(intro);
        crops.push(null);
      }
      for (const seg of lessonSegments) {
        inputs.push(seg.path);
        crops.push(seg.crop);
      }
      const outro = await brandingInput(school, 'outro', job.lessonId, temps);
      if (outro) {
        inputs.push(outro);
        crops.push(null);
      }

      // Optional "do not distribute" watermark (only when a font is configured).
      let overlay: { text: string; fontPath: string } | undefined;
      const overlayText = school?.overlayText?.trim();
      if (overlayText && env.FONT_PATH) {
        overlay = { text: overlayText, fontPath: env.FONT_PATH };
      }

      try {
        await runFfmpeg(buildConcatArgs(inputs, output, overlay ? { overlay, crops } : { crops }));
      } catch (err) {
        // Never fail the whole video over a watermark/font issue: retry plain.
        if (!overlay) throw err;
        console.warn('[worker] overlay mislukt, opnieuw zonder watermerk:', err);
        await runFfmpeg(buildConcatArgs(inputs, output, { crops }));
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

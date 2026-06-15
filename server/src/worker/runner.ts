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
import { detectToneOnset } from '../lib/tone.js';
import {
  SYNC_TONE_DURATION_MS,
  type SyncSegmentReport,
  type SyncStreamReport,
} from '@practiceroom/shared';
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

/** Round to milliseconds for readable diagnostics. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** How a group's streams were aligned, with the data behind the decision. */
interface GroupAlignment {
  method: 'tone' | 'duration' | 'none';
  skips: Map<string, number>;
  onset: Map<string, number | null>;
  duration: Map<string, number | null>;
}

/**
 * Per-file front-trim (seconds) that aligns a group's independently-started
 * streams, plus the diagnostics behind it. Prefers the sync tone (frame-exact:
 * trim each to just after its own detected tone) when the group used one and it
 * is found in EVERY track. Else it aligns by duration (assumes the devices
 * stopped together, trimming each to the common window). Else no trim.
 */
async function computeGroupAlignment(paths: string[], usedSyncTone: boolean): Promise<GroupAlignment> {
  const skips = new Map<string, number>();
  const onset = new Map<string, number | null>();
  const duration = new Map<string, number | null>();

  // Probe durations always — used for the fallback and shown in diagnostics.
  const durations = await Promise.all(paths.map((p) => probeDuration(p)));
  paths.forEach((p, i) => duration.set(p, durations[i]! > 0 ? round3(durations[i]!) : null));

  if (usedSyncTone) {
    const onsets = await Promise.all(paths.map((p) => detectToneOnset(p)));
    paths.forEach((p, i) => onset.set(p, onsets[i] !== null ? round3(onsets[i]!) : null));
    if (onsets.every((o) => o !== null)) {
      const toneEnd = SYNC_TONE_DURATION_MS / 1000;
      paths.forEach((p, i) => skips.set(p, round3((onsets[i] as number) + toneEnd)));
      return { method: 'tone', skips, onset, duration };
    }
  } else {
    paths.forEach((p) => onset.set(p, null));
  }

  if (durations.every((d) => d > 0)) {
    const minD = Math.min(...durations);
    paths.forEach((p, i) => skips.set(p, round3(Math.max(0, durations[i]! - minD))));
    return { method: 'duration', skips, onset, duration };
  }
  paths.forEach((p) => skips.set(p, 0));
  return { method: 'none', skips, onset, duration };
}

/** Prints a readable per-segment sync summary to the worker console. */
function logSyncReports(lessonId: string, reports: SyncSegmentReport[]): void {
  for (const seg of reports) {
    const parts = seg.streams.map((s) => {
      const onset = s.toneOnsetS === null ? 'geen toon' : `toon@${s.toneOnsetS}s`;
      const dur = s.durationS === null ? '?' : `${s.durationS}s`;
      const noAudio = s.hasAudio ? '' : ' (geen audio)';
      return `${s.role} ${s.deviceId.slice(-4)}: ${onset}, dur=${dur}, skip=${s.skipS}s${noAudio}`;
    });
    console.info(
      `[worker] sync lesson=${lessonId} segment ${seg.segment} methode=${seg.method} | ${parts.join(' | ')}`,
    );
  }
}

function streamReport(
  role: string,
  rec: Recording,
  path: string,
  align: GroupAlignment,
): SyncStreamReport {
  return {
    role,
    deviceId: rec.deviceId,
    hasAudio: rec.hasAudio,
    durationS: align.duration.get(path) ?? null,
    toneOnsetS: align.onset.get(path) ?? null,
    skipS: round3(align.skips.get(path) ?? 0),
  };
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
): Promise<{ inputs: SegmentInput[]; reports: SyncSegmentReport[] }> {
  const groups = new Map<string, Recording[]>();
  for (const r of completed) {
    const key = r.segmentGroupId ?? `solo:${r.id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const ordered: { startedAt: number; input: SegmentInput; streams: SyncStreamReport[]; method: GroupAlignment['method'] }[] = [];
  for (const members of groups.values()) {
    const audioRec = members.find((r) => r.isAudioTrack) ?? null;
    // Video participants: a composed source's laid-out members (one of which may
    // ALSO be the audio source, so it stays a video layer too), or — for a single
    // camera — every non-auxiliary recording. A pure auxiliary audio track (the
    // room mic, no layout) is never shown.
    const layoutMembers = members.filter((r) => r.layoutRole !== null);
    const videoMembers =
      layoutMembers.length > 0 ? layoutMembers : members.filter((r) => !r.isAudioTrack);
    if (videoMembers.length === 0) continue; // lone audio track: auxiliary

    // The full-frame camera, plus any picture-in-picture insets (composed source).
    const main = videoMembers.find((r) => r.layoutRole === 'main') ?? videoMembers[0]!;
    const pips = videoMembers.filter((r) => r.layoutRole === 'pip' && r.hasVideo);

    const usedSyncTone = members.some((r) => r.syncTone);

    let path: string;
    let crop: CropRect | null;
    let method: GroupAlignment['method'] = 'none';
    const streams: SyncStreamReport[] = [];
    if (pips.length > 0 && main.hasVideo) {
      // Composed source: overlay the insets onto the main camera, with the audio
      // source's sound (when present) laid under the result. Align all layers by
      // the sync tone (or duration as a fallback) so they line up frame-exactly.
      const mainPath = recordingPath(main.id);
      const pipPaths = pips.map((p) => recordingPath(p.id));
      const audioPath = audioRec ? recordingPath(audioRec.id) : null;
      const allPaths = [mainPath, ...pipPaths, ...(audioPath ? [audioPath] : [])];
      const align = await computeGroupAlignment(allPaths, usedSyncTone);
      const skipOf = (p: string) => align.skips.get(p) ?? 0;

      path = composedSegmentPath(lessonId, main.id);
      await runFfmpeg(
        buildPipCompositeArgs(
          { input: mainPath, skip: skipOf(mainPath) },
          pips.map((p, i) => ({
            input: pipPaths[i]!,
            position: (p.layoutPosition ?? 'bottom-right') as PipInput['position'],
            scale: p.layoutScale ?? 0.28,
            skip: skipOf(pipPaths[i]!),
          })),
          audioPath ? { input: audioPath, skip: skipOf(audioPath) } : null,
          path,
        ),
      );
      temps.push(path);
      crop = null; // a crop does not apply to a composed frame
      method = align.method;
      streams.push(streamReport('main', main, mainPath, align));
      pips.forEach((p, i) => streams.push(streamReport('pip', p, pipPaths[i]!, align)));
      if (audioRec && audioPath) streams.push(streamReport('audio', audioRec, audioPath, align));
    } else if (audioRec && main.hasVideo) {
      // Single camera with the audio source's sound laid under it, aligned by the
      // sync tone (or duration fallback). Aligning needs a re-encode, so the
      // output then goes to an .mkv; without alignment it stays a fast .webm copy.
      const mainPath = recordingPath(main.id);
      const audioPath = recordingPath(audioRec.id);
      const align = await computeGroupAlignment([mainPath, audioPath], usedSyncTone);
      const vSkip = align.skips.get(mainPath) ?? 0;
      const aSkip = align.skips.get(audioPath) ?? 0;
      const aligned = vSkip > 0 || aSkip > 0;
      path = aligned
        ? composedSegmentPath(lessonId, main.id)
        : normalizedSegmentPath(lessonId, main.id);
      await runFfmpeg(
        buildMuxVideoOverAudioArgs({ input: mainPath, skip: vSkip }, { input: audioPath, skip: aSkip }, path),
      );
      temps.push(path);
      crop = recordingCrop(main);
      method = align.method;
      streams.push(streamReport('main', main, mainPath, align));
      streams.push(streamReport('audio', audioRec, audioPath, align));
    } else {
      path = await normalizeSegment(lessonId, main, temps);
      crop = recordingCrop(main);
      method = 'none';
      streams.push({
        role: 'single',
        deviceId: main.deviceId,
        hasAudio: main.hasAudio,
        durationS: null,
        toneOnsetS: null,
        skipS: 0,
      });
    }
    ordered.push({ startedAt: main.startedAt.getTime(), input: { path, crop }, streams, method });
  }

  ordered.sort((a, b) => a.startedAt - b.startedAt);
  return {
    inputs: ordered.map((o) => o.input),
    reports: ordered.map((o, i) => ({ segment: i + 1, method: o.method, streams: o.streams })),
  };
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
    let syncReports: SyncSegmentReport[] = [];
    try {
      const built = await buildLessonSegments(job.lessonId, completed, temps);
      const lessonSegments = built.inputs;
      syncReports = built.reports;
      logSyncReports(job.lessonId, syncReports);
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
        syncReport: JSON.stringify(syncReports),
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

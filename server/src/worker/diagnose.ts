/**
 * Sync diagnostic — run on the REAL failing recordings to see, with hard
 * measurements, exactly where front-trim alignment breaks. This exists because
 * we kept guessing at ffmpeg timestamp behaviour instead of measuring the actual
 * Pi/laptop files. It runs the full pipeline (normalize → trim) on each file and
 * reports the timeline facts after every stage, plus a PASS/FAIL on whether the
 * trim actually cut.
 *
 * Usage (inside the worker container, after `docker compose up -d --build`):
 *   docker compose exec worker node dist/worker/diagnose.js \
 *     /data/storage/recordings/<main>.webm /data/storage/recordings/<pip>.webm
 *
 * Pass the main (full-frame) file first and the PiP (inset) file second. A third
 * optional arg is the separate audio-source file.
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCanonicalExternalArgs, buildTrimArgs, COMPOSITE_FPS } from '../lib/composite.js';
import { probeDuration, probeStreamTimeline, probeStreams } from '../lib/probe.js';
import { detectToneOnset } from '../lib/tone.js';
import { SYNC_TONE_DURATION_MS } from '@practiceroom/shared';
import { runFfmpeg } from './runner.js';
import { removeFile } from '../lib/storage.js';

function f(n: number | null): string {
  return n === null ? 'n/a' : n.toFixed(3);
}

/** Print every timeline fact about a file: per-stream first/last PTS, count, and
 * whether the video looks zero-based and constant-rate. */
async function dump(label: string, path: string): Promise<void> {
  const { hasVideo, hasAudio } = await probeStreams(path);
  const v = await probeStreamTimeline(path, 'v:0');
  const a = await probeStreamTimeline(path, 'a:0');
  const dur = await probeDuration(path);
  console.log(`\n── ${label}`);
  console.log(`   file: ${path}`);
  console.log(`   streams: video=${hasVideo} audio=${hasAudio}  container dur=${f(dur)}s`);
  if (hasVideo) {
    const span = v.first !== null && v.last !== null ? v.last - v.first : null;
    const fpsApprox = span && span > 0 ? (v.count - 1) / span : null;
    console.log(
      `   VIDEO  firstPTS=${f(v.first)}  lastPTS=${f(v.last)}  packets=${v.count}` +
        `  span=${f(span)}s  ~fps=${fpsApprox === null ? 'n/a' : fpsApprox.toFixed(1)}`,
    );
    if (v.first !== null && Math.abs(v.first) > 0.05) {
      console.log(`   ⚠ VIDEO does NOT start at 0 (firstPTS=${f(v.first)}) — fps may front-pad with frozen frames.`);
    }
  }
  if (hasAudio) {
    console.log(`   AUDIO  firstPTS=${f(a.first)}  lastPTS=${f(a.last)}  packets=${a.count}`);
  }
  if (hasVideo && hasAudio && v.first !== null && a.first !== null) {
    console.log(`   A/V start offset (vFirst - aFirst) = ${f(v.first - a.first)}s`);
  }
}

/** Normalize → trim one file, measuring after each stage and verifying the cut. */
async function pipeline(role: string, src: string, temps: string[]): Promise<void> {
  console.log(`\n================ ${role.toUpperCase()} ================`);
  await dump(`${role} RAW`, src);

  const { hasVideo, hasAudio } = await probeStreams(src);
  const tone = await detectToneOnset(src);
  const toneEnd = (SYNC_TONE_DURATION_MS + 100) / 1000;
  if (tone) {
    console.log(`\n   chirp onset (audio) = ${tone.onsetS.toFixed(3)}s  dominance=${tone.dominance.toFixed(3)}`);
  } else {
    console.log(`\n   ⚠ chirp NOT detected — alignment would fall back to duration.`);
  }
  const skip = tone ? tone.onsetS + toneEnd : 0;
  console.log(`   computed skip = ${skip.toFixed(3)}s`);

  // Stage 1: normalize.
  const norm = join(tmpdir(), `diag-${randomUUID()}.norm.mp4`);
  temps.push(norm);
  await runFfmpeg(buildCanonicalExternalArgs(src, norm, hasVideo, hasAudio, 0));
  await dump(`${role} NORMALIZED (stage 1)`, norm);

  if (skip <= 0.001) {
    console.log('\n   (skip ≈ 0, nothing to trim)');
    return;
  }

  // Stage 2: trim.
  const trimmed = join(tmpdir(), `diag-${randomUUID()}.trim.mp4`);
  temps.push(trimmed);
  const normDur = await probeDuration(norm);
  await runFfmpeg(buildTrimArgs(norm, skip, trimmed));
  await dump(`${role} TRIMMED (stage 2)`, trimmed);

  const trimDur = await probeDuration(trimmed);
  const expected = Math.max(0, normDur - skip);
  const delta = Math.abs(trimDur - expected);
  console.log(
    `\n   TRIM VERDICT: norm=${normDur.toFixed(3)}s skip=${skip.toFixed(3)}s ` +
      `→ expected≈${expected.toFixed(3)}s, got ${trimDur.toFixed(3)}s`,
  );
  if (delta <= 0.3) {
    console.log(`   ✅ PASS — trim bit (Δ=${delta.toFixed(3)}s). Front cut correctly.`);
  } else {
    console.log(`   ❌ FAIL — trim did NOT bite (Δ=${delta.toFixed(3)}s). The ${role} keeps its pre-roll/chirp.`);
  }
}

async function main(): Promise<void> {
  const [mainSrc, pipSrc, audioSrc] = process.argv.slice(2);
  if (!mainSrc || !pipSrc) {
    console.error('Gebruik: node dist/worker/diagnose.js <main.webm> <pip.webm> [audio.webm]');
    process.exit(2);
  }
  console.log(`Sync-diagnose · fps=${COMPOSITE_FPS}`);
  const temps: string[] = [];
  try {
    await pipeline('main', mainSrc, temps);
    await pipeline('pip', pipSrc, temps);
    if (audioSrc) await pipeline('audio', audioSrc, temps);
    console.log(
      '\nKlaar. Stuur deze volledige uitvoer terug. Let vooral op:\n' +
        ' • of VIDEO firstPTS ≈ 0 is in RAW én NORMALIZED (zo niet → fps front-padding);\n' +
        ' • of de chirp-onset in main en pip overeenkomt met het akoestische moment;\n' +
        ' • de TRIM VERDICT-regel per laag (PASS/FAIL).',
    );
  } finally {
    for (const t of temps) await removeFile(t);
  }
}

main().catch((err) => {
  console.error('diagnose mislukt:', err);
  process.exit(1);
});

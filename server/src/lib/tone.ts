import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { SYNC_TONE_DURATION_MS, SYNC_TONE_FREQUENCY_HZ } from '@practiceroom/shared';
import { env } from '../env.js';

// We only need a coarse spectrum to spot a loud pure tone, so decode to mono at a
// low rate. 1000 Hz lands exactly on a bin at 8 kHz with a 10 ms (80-sample)
// window, which makes the Goertzel estimate clean.
const SAMPLE_RATE = 8000;
const WINDOW_SAMPLES = 80; // 10 ms
const ANALYZE_SECONDS = 12; // the tone plays near the very start
// Fraction of a window's energy that must sit at the tone frequency. A pure tone
// approaches ~0.5; music/speech rarely exceeds ~0.05 in a single 100 Hz bin.
const DOMINANCE_THRESHOLD = 0.12;
// The tone must persist for at least this fraction of its length to count (filters
// out transient hits), and that run's start is the onset.
const MIN_RUN_RATIO = 0.4;

function ffmpegPath(): string {
  return env.FFMPEG_PATH || ffmpegInstaller.path;
}

/** Decode the first seconds of a file to mono float32 PCM at SAMPLE_RATE. */
function decodePcm(path: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath(),
      [
        '-v', 'error',
        '-t', String(ANALYZE_SECONDS),
        '-i', path,
        '-vn',
        '-ac', '1',
        '-ar', String(SAMPLE_RATE),
        '-f', 'f32le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', reject);
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const usable = buf.byteLength - (buf.byteLength % 4);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, usable / 4));
    });
  });
}

/** Squared magnitude of the tone bin over one window (Goertzel). */
function toneBinPower(samples: Float32Array, start: number, n: number): number {
  const k = (2 * Math.PI * SYNC_TONE_FREQUENCY_HZ) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(k);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[start + i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Returns the start time (seconds) of the sync tone in an audio file, or null if
 * it is not found. The tone is the same one the room speaker plays, so detecting
 * it in each camera's audio lets the worker align the independently-started
 * recordings frame-exactly.
 */
export async function detectToneOnset(path: string): Promise<number | null> {
  let samples: Float32Array;
  try {
    samples = await decodePcm(path);
  } catch {
    return null;
  }
  if (samples.length < WINDOW_SAMPLES) return null;

  const minRun = Math.round((SYNC_TONE_DURATION_MS / 1000) * (SAMPLE_RATE / WINDOW_SAMPLES) * MIN_RUN_RATIO);
  let run = 0;
  let onsetWindow = -1;
  for (let w = 0, start = 0; start + WINDOW_SAMPLES <= samples.length; w++, start += WINDOW_SAMPLES) {
    let total = 0;
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const v = samples[start + i]!;
      total += v * v;
    }
    const power = toneBinPower(samples, start, WINDOW_SAMPLES);
    // Fraction of the window's energy at the tone frequency (Parseval-normalised).
    const dominance = total > 1e-7 ? power / (WINDOW_SAMPLES * total) : 0;
    if (dominance >= DOMINANCE_THRESHOLD) {
      if (run === 0) onsetWindow = w;
      run++;
      if (run >= minRun) return (onsetWindow * WINDOW_SAMPLES) / SAMPLE_RATE;
    } else {
      run = 0;
      onsetWindow = -1;
    }
  }
  return null;
}

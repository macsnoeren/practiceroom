import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { SYNC_TONE_FREQUENCY_HZ } from '@practiceroom/shared';
import { env } from '../env.js';

// Decode to mono at a low rate; 1000 Hz lands on a clean Goertzel bin at 8 kHz.
const SAMPLE_RATE = 8000;
const WINDOW_SAMPLES = 40; // 5 ms Goertzel window (a few cycles of 1 kHz)
const HOP_SAMPLES = 8; // 1 ms hop → a fine energy envelope for the rising edge
const ANALYZE_SECONDS = 12; // the tone plays near the very start
// Fraction of a window's energy that must sit at the tone frequency to count it
// as "tone present" (a pure tone approaches ~0.5; music/speech stays well below).
const DOMINANCE_THRESHOLD = 0.12;
// The tone must dominate this long to be the sync tone (filters out transients).
const SUSTAIN_S = 0.8;
// Align on where the tone's energy first rises through this fraction of its own
// plateau. Using a fraction of each stream's plateau makes the detected moment
// amplitude-independent, so a loud and a quiet mic land on the same instant.
const EDGE_FRACTION = 0.5;

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

/** Median of arr[from..to) — robust plateau estimate. */
function median(arr: Float64Array, from: number, to: number): number {
  const slice = Array.from(arr.subarray(from, to)).sort((a, b) => a - b);
  if (slice.length === 0) return 0;
  const mid = slice.length >> 1;
  return slice.length % 2 ? slice[mid]! : (slice[mid - 1]! + slice[mid]!) / 2;
}

/** A detected sync tone, with quality metrics for diagnostics. */
export interface ToneDetection {
  /** Start time (seconds): the rising edge at 50% of the tone's own plateau. */
  onsetS: number;
  /** 10%→90% rise time (ms). Small = sharp edge = precise; large = smeared
   * (reverb/noise) = the onset — and thus the alignment — is less reliable. */
  riseMs: number;
  /** Plateau dominance (0…~0.5): how cleanly the tone stands out (higher better). */
  dominance: number;
}

/**
 * Detects the sync tone in an audio file (or null if not found). The tone is the
 * same one the room speaker plays, so detecting it in each camera's audio lets
 * the worker align the independently-started recordings.
 *
 * It first finds where the tone sustainedly dominates, then aligns on the rising
 * edge at a fraction of THAT stream's own plateau (interpolated between 1 ms
 * hops). Anchoring to a fraction of the plateau makes the detected instant
 * independent of how loud the tone is at each mic. Also returns quality metrics
 * (rise time, dominance) so the control room can judge how reliable it is.
 */
export async function detectToneOnset(path: string): Promise<ToneDetection | null> {
  let samples: Float32Array;
  try {
    samples = await decodePcm(path);
  } catch {
    return null;
  }
  if (samples.length < WINDOW_SAMPLES * 2) return null;

  // Fine envelope of tone-frequency magnitude and its dominance, per 1 ms hop.
  const hops = Math.floor((samples.length - WINDOW_SAMPLES) / HOP_SAMPLES) + 1;
  const mag = new Float64Array(hops);
  const dom = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    const start = h * HOP_SAMPLES;
    let total = 0;
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const v = samples[start + i]!;
      total += v * v;
    }
    const power = toneBinPower(samples, start, WINDOW_SAMPLES);
    mag[h] = Math.sqrt(Math.max(0, power));
    dom[h] = total > 1e-7 ? power / (WINDOW_SAMPLES * total) : 0;
  }

  // Locate the sustained tone: first hop after which it dominates for SUSTAIN_S.
  const sustainHops = Math.round((SUSTAIN_S * SAMPLE_RATE) / HOP_SAMPLES);
  let sustainStart = -1;
  let run = 0;
  for (let h = 0; h < hops; h++) {
    if (dom[h]! >= DOMINANCE_THRESHOLD) {
      run++;
      if (run >= sustainHops) {
        sustainStart = h - run + 1;
        break;
      }
    } else {
      run = 0;
    }
  }
  if (sustainStart < 0) return null;

  // Plateau magnitude (robust) and the dominance there (detection cleanliness).
  const plateau = median(mag, sustainStart, Math.min(hops, sustainStart + sustainHops));
  if (plateau <= 1e-6) return null;
  const dominance = median(dom, sustainStart, Math.min(hops, sustainStart + sustainHops));

  // Interpolated hop where the rising edge crosses `frac` of the plateau,
  // scanning back from the plateau. Returns sustainStart if it runs off the start.
  const risingCross = (frac: number): number => {
    const level = frac * plateau;
    for (let h = sustainStart; h > 0; h--) {
      if (mag[h]! >= level && mag[h - 1]! < level) {
        const t = (level - mag[h - 1]!) / (mag[h]! - mag[h - 1]!);
        return h - 1 + t;
      }
    }
    return sustainStart;
  };

  // Window magnitude reflects energy centred in the window, so add half a window.
  const hopToS = (hop: number) => (hop * HOP_SAMPLES + WINDOW_SAMPLES / 2) / SAMPLE_RATE;
  const onsetS = hopToS(risingCross(EDGE_FRACTION));
  const riseMs = Math.max(0, (hopToS(risingCross(0.9)) - hopToS(risingCross(0.1))) * 1000);
  return { onsetS, riseMs, dominance };
}

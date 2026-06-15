import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import {
  SYNC_CHIRP_END_HZ,
  SYNC_CHIRP_START_HZ,
  SYNC_TONE_DURATION_MS,
  SYNC_TONE_FADE_MS,
} from '@practiceroom/shared';
import { env } from '../env.js';

// 16 kHz captures the whole sweep (up to 5 kHz) for a sharp correlation peak.
const SAMPLE_RATE = 16000;
const ANALYZE_SECONDS = 15; // the chirp plays within the first several seconds
// Minimum peak prominence (0..1) to accept a detection; below this we treat the
// chirp as "not found" and fall back to duration alignment.
const MIN_PROMINENCE = 0.15;

/** A detected sync marker, with a confidence metric for diagnostics. */
export interface ToneDetection {
  /** Start time (seconds) of the chirp in this stream (sub-sample, matched filter). */
  onsetS: number;
  /** Not used by the chirp detector (kept for report compatibility). */
  riseMs: number | null;
  /** Correlation peak prominence 0..1: how cleanly the chirp was found (higher
   * = sharper, more reliable; near 0 = ambiguous/absent). */
  dominance: number;
}

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

/**
 * The ANALYTIC version of the linear chirp the speaker plays (cos + j·sin), for
 * matched filtering. Correlating the recording with the complex template and
 * taking the magnitude makes the detection independent of the recorded chirp's
 * carrier phase — a real template would give a phase-dependent (sometimes near-
 * zero) peak.
 */
function generateTemplate(): { re: Float64Array; im: Float64Array; length: number } {
  const length = Math.round((SAMPLE_RATE * SYNC_TONE_DURATION_MS) / 1000);
  const t1 = SYNC_TONE_DURATION_MS / 1000;
  const f0 = SYNC_CHIRP_START_HZ;
  const halfRate = (SYNC_CHIRP_END_HZ - f0) / (2 * t1); // 0.5 * sweep rate
  const fade = Math.max(1, Math.round((SAMPLE_RATE * SYNC_TONE_FADE_MS) / 1000));
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    const t = n / SAMPLE_RATE;
    const phase = 2 * Math.PI * (f0 * t + halfRate * t * t);
    let w = 1;
    if (n < fade) w = n / fade;
    else if (n > length - fade) w = (length - n) / fade;
    re[n] = Math.cos(phase) * w;
    im[n] = Math.sin(phase) * w;
  }
  return { re, im, length };
}

/** In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k]!;
        const aIm = im[i + k]!;
        const r2 = re[i + k + half]!;
        const i2 = im[i + k + half]!;
        const bRe = r2 * curRe - i2 * curIm;
        const bIm = r2 * curIm + i2 * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}

/**
 * Detects the sync chirp in an audio file (or null if not found), by matched-
 * filter cross-correlation with the known sweep. The correlation peak gives the
 * chirp's arrival time to sub-sample precision; because a sweep is broadband the
 * peak is sharp and locks onto the direct sound, so it is far more reliable in a
 * reverberant room than a steady tone's smeared onset. Returns a prominence
 * (peak vs. the next strongest peak) as a confidence metric.
 */
export async function detectToneOnset(path: string): Promise<ToneDetection | null> {
  let samples: Float32Array;
  try {
    samples = await decodePcm(path);
  } catch {
    return null;
  }
  const template = generateTemplate();
  const analyzeLen = Math.min(samples.length, ANALYZE_SECONDS * SAMPLE_RATE);
  if (analyzeLen < template.length * 2) return null;

  let n = 1;
  while (n < analyzeLen + template.length) n <<= 1;

  const sRe = new Float64Array(n);
  const sIm = new Float64Array(n);
  for (let i = 0; i < analyzeLen; i++) sRe[i] = samples[i]!;
  const tRe = new Float64Array(n);
  const tIm = new Float64Array(n);
  for (let i = 0; i < template.length; i++) {
    tRe[i] = template.re[i]!;
    tIm[i] = template.im[i]!;
  }

  fft(sRe, sIm, false);
  fft(tRe, tIm, false);
  // Cross-correlation = IFFT(S · conj(T)) with a COMPLEX (analytic) template;
  // its magnitude peaks at the chirp's arrival regardless of carrier phase.
  for (let k = 0; k < n; k++) {
    const ar = sRe[k]!;
    const ai = sIm[k]!;
    const br = tRe[k]!;
    const bi = tIm[k]!;
    sRe[k] = ar * br + ai * bi;
    sIm[k] = ai * br - ar * bi;
  }
  fft(sRe, sIm, true);

  const maxLag = analyzeLen - template.length;
  const mag = (m: number) => Math.hypot(sRe[m]!, sIm[m]!);
  let peak = -Infinity;
  let peakIdx = 0;
  for (let m = 0; m <= maxLag; m++) {
    const v = mag(m);
    if (v > peak) {
      peak = v;
      peakIdx = m;
    }
  }
  if (peak <= 0) return null;

  // Prominence: how much the peak beats the next-strongest peak outside a guard.
  const guard = Math.round(template.length / 2);
  let second = 0;
  for (let m = 0; m <= maxLag; m++) {
    if (Math.abs(m - peakIdx) <= guard) continue;
    const v = mag(m);
    if (v > second) second = v;
  }
  const prominence = Math.max(0, Math.min(1, (peak - second) / peak));
  if (prominence < MIN_PROMINENCE) return null;

  // Sub-sample peak position via parabolic interpolation on the magnitude.
  let delta = 0;
  if (peakIdx > 0 && peakIdx < maxLag) {
    const y0 = mag(peakIdx - 1);
    const y1 = peak;
    const y2 = mag(peakIdx + 1);
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) delta = (0.5 * (y0 - y2)) / denom;
  }

  return { onsetS: (peakIdx + delta) / SAMPLE_RATE, riseMs: null, dominance: prominence };
}

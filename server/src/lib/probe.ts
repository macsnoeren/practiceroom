import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { env } from '../env.js';

const execFileP = promisify(execFile);

function ffprobePath(): string {
  return env.FFPROBE_PATH || ffprobeInstaller.path;
}

/**
 * Reports which stream types a media file has. Used to pad an intro/outro clip
 * with a silent track or a black frame before concatenating, so a clip that
 * lacks audio (or video) still stitches in cleanly. On any error it assumes
 * both are present and lets the concat step try.
 */
/**
 * The media duration in seconds, or 0 when it cannot be determined. Live-recorded
 * WebM/Matroska (from MediaRecorder or an ffmpeg pipe) often carries no duration
 * in its header, so when `format=duration` is absent we fall back to the
 * timestamp of the last video packet — which is accurate even for variable frame
 * rate and needs no decoding.
 */
export async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execFileP(ffprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path,
    ]);
    const d = Number.parseFloat(stdout.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // fall through to the packet-based estimate
  }
  try {
    const { stdout } = await execFileP(
      ffprobePath(),
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'packet=pts_time',
        '-of',
        'csv=p=0',
        path,
      ],
      { maxBuffer: 128 * 1024 * 1024 },
    );
    let max = 0;
    for (const line of stdout.split('\n')) {
      const t = Number.parseFloat(line);
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max;
  } catch {
    return 0;
  }
}

/** First packet timestamp (seconds) of the given stream, or null if none. */
async function firstPacketPts(path: string, stream: 'v:0' | 'a:0'): Promise<number | null> {
  try {
    const { stdout } = await execFileP(ffprobePath(), [
      '-v',
      'error',
      '-select_streams',
      stream,
      '-show_entries',
      'packet=pts_time',
      '-read_intervals',
      '%+#1',
      '-of',
      'csv=p=0',
      path,
    ]);
    for (const line of stdout.split('\n')) {
      const t = Number.parseFloat(line);
      if (Number.isFinite(t)) return t;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The audio/video start offset in a file: `firstVideoPts - firstAudioPts`
 * (seconds), or 0 when a stream is missing or it cannot be determined.
 *
 * The browser camera muxes one synchronized A/V stream (offset ≈ 0), but the Pi
 * agent muxes two independent inputs (`-f v4l2` + `-f alsa`) and the camera often
 * needs seconds to deliver its first frame while audio flows immediately — so the
 * video stream starts well after the audio. Because the sync chirp is detected in
 * the audio (audio-relative) but the video is trimmed on its own re-zeroed
 * timeline, this offset must be subtracted from the video skip or the inset ends
 * up out of sync by exactly this amount.
 */
export async function probeAvOffset(path: string): Promise<number> {
  const [v, a] = await Promise.all([
    firstPacketPts(path, 'v:0'),
    firstPacketPts(path, 'a:0'),
  ]);
  if (v === null || a === null) return 0;
  const offset = v - a;
  return Number.isFinite(offset) ? offset : 0;
}

export async function probeStreams(
  path: string,
): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  try {
    const { stdout } = await execFileP(ffprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      path,
    ]);
    const data = JSON.parse(stdout) as { streams?: { codec_type?: string }[] };
    const streams = data.streams ?? [];
    return {
      hasVideo: streams.some((s) => s.codec_type === 'video'),
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
    };
  } catch {
    return { hasVideo: true, hasAudio: true };
  }
}

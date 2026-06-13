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

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

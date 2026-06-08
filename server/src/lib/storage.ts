import { appendFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../env.js';

const root = resolve(env.STORAGE_DIR);

/** Absolute path of a recording's video file. */
export function recordingPath(recordingId: string): string {
  return join(root, 'recordings', `${recordingId}.webm`);
}

/** Append a chunk to the recording file, creating the folder on first write. */
export async function appendChunk(recordingId: string, data: Buffer): Promise<void> {
  const path = recordingPath(recordingId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, data);
}

export async function recordingSize(recordingId: string): Promise<number> {
  try {
    return (await stat(recordingPath(recordingId))).size;
  } catch {
    return 0;
  }
}

/** Absolute path of a lesson's combined (composite) video file. */
export function compositePath(lessonId: string): string {
  return join(root, 'composites', `${lessonId}.mp4`);
}

/** Ensure the composites folder exists (the worker writes here via ffmpeg). */
export async function ensureCompositeDir(lessonId: string): Promise<void> {
  await mkdir(dirname(compositePath(lessonId)), { recursive: true });
}

export async function compositeSize(lessonId: string): Promise<number> {
  try {
    return (await stat(compositePath(lessonId))).size;
  } catch {
    return 0;
  }
}

/** Remove all stored recordings (used by tests). */
export async function clearStorage(): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

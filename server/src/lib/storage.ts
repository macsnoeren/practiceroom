import { appendFile, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../env.js';

const root = resolve(env.STORAGE_DIR);

/** Absolute path of a library item's video file (no extension; mime is stored). */
export function libraryPath(itemId: string): string {
  return join(root, 'library', `${itemId}`);
}

/** Append a chunk to a library file, creating the folder on first write. */
export async function appendLibraryChunk(itemId: string, data: Buffer): Promise<void> {
  const path = libraryPath(itemId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, data);
}

export async function librarySize(itemId: string): Promise<number> {
  try {
    return (await stat(libraryPath(itemId))).size;
  } catch {
    return 0;
  }
}

/** Copy a lesson's composite video into the library as a standalone file. */
export async function copyCompositeToLibrary(lessonId: string, itemId: string): Promise<number> {
  const dest = libraryPath(itemId);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(compositePath(lessonId), dest);
  return librarySize(itemId);
}

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

/**
 * Path for a temporary normalised segment (a black-video or silent-audio
 * version of a recording), written next to the composite while it is built.
 */
export function normalizedSegmentPath(lessonId: string, recordingId: string): string {
  return join(root, 'composites', `${lessonId}.norm.${recordingId}.webm`);
}

/** Best-effort removal of a file (used to clean up temporary segments). */
export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
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

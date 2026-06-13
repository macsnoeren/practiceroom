import { access, appendFile, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../env.js';

const root = resolve(env.STORAGE_DIR);

export type BrandingSlot = 'intro' | 'outro';

/** Final path of a school's intro/outro clip used by the composite worker. */
export function brandingPath(schoolId: string, slot: BrandingSlot): string {
  return join(root, 'branding', schoolId, slot);
}

function brandingTempPath(schoolId: string, slot: BrandingSlot): string {
  return `${brandingPath(schoolId, slot)}.part`;
}

/** Append a chunk to the in-progress upload (a temp file alongside the final).
 * Index 0 starts fresh, so a re-started upload overwrites any leftover. */
export async function appendBrandingChunk(
  schoolId: string,
  slot: BrandingSlot,
  data: Buffer,
  index: number,
): Promise<void> {
  const path = brandingTempPath(schoolId, slot);
  await mkdir(dirname(path), { recursive: true });
  if (index === 0) await writeFile(path, data);
  else await appendFile(path, data);
}

/** Promote the finished upload to the final path so the worker never sees a
 * half-written clip. Returns the final size. */
export async function finalizeBranding(schoolId: string, slot: BrandingSlot): Promise<number> {
  const final = brandingPath(schoolId, slot);
  await rename(brandingTempPath(schoolId, slot), final);
  return (await stat(final)).size;
}

export async function brandingExists(schoolId: string, slot: BrandingSlot): Promise<boolean> {
  try {
    await access(brandingPath(schoolId, slot));
    return true;
  } catch {
    return false;
  }
}

export async function removeBranding(schoolId: string, slot: BrandingSlot): Promise<void> {
  await rm(brandingPath(schoolId, slot), { force: true });
  await rm(brandingTempPath(schoolId, slot), { force: true });
}

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

/**
 * Temp path for a composed (picture-in-picture) segment built from several
 * cameras. Uses Matroska so the re-encoded h264/opus overlay result stores
 * cleanly before the concat step re-encodes it like any other segment.
 */
export function composedSegmentPath(lessonId: string, recordingId: string): string {
  return join(root, 'composites', `${lessonId}.pip.${recordingId}.mkv`);
}

/** Best-effort removal of a file (used to clean up temporary segments). */
export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
}

/** Temp path for a canonicalised intro/outro clip while a composite is built. */
export function normalizedBrandingPath(lessonId: string, slot: BrandingSlot): string {
  return join(root, 'composites', `${lessonId}.norm.${slot}.mp4`);
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

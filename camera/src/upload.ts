import type { CropRect } from '@practiceroom/shared';
import { getToken } from './api.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads recording chunks to the server strictly in order. Chunks stay in the
 * queue until the server confirms them, so a brief network drop just means the
 * same chunk is retried — nothing is lost and order is preserved.
 */
export class ChunkUploader {
  private queue: Blob[] = [];
  private index = 0;
  private running = false;
  private done = false;

  constructor(private readonly recordingId: string) {}

  enqueue(chunk: Blob): void {
    this.queue.push(chunk);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const ok = await this.send(this.index, this.queue[0]!);
        if (ok) {
          this.queue.shift();
          this.index += 1;
        } else {
          await delay(1000); // brief backoff, then retry the same chunk
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async send(index: number, chunk: Blob): Promise<boolean> {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch(`/api/recordings/${this.recordingId}/chunks?index=${index}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
        body: chunk,
      });
      // 200 covers both a fresh append and an idempotent retry of a chunk the
      // server already has (after a lost response).
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Wait for the queue to drain, then mark the recording complete. */
  async finish(
    mimeType: string,
    opts: { hasVideo: boolean; hasAudio: boolean; crop?: CropRect | null },
  ): Promise<void> {
    if (this.done) return;
    this.done = true;
    while (this.queue.length > 0 || this.running) await delay(200);

    const token = getToken();
    if (!token) return;
    const params = new URLSearchParams({
      mimeType,
      hasVideo: String(opts.hasVideo),
      hasAudio: String(opts.hasAudio),
    });
    if (opts.crop) {
      params.set('cropX', String(opts.crop.x));
      params.set('cropY', String(opts.crop.y));
      params.set('cropW', String(opts.crop.w));
      params.set('cropH', String(opts.crop.h));
    }
    await fetch(`/api/recordings/${this.recordingId}/complete?${params.toString()}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
}

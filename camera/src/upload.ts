import type { CropRect } from '@practiceroom/shared';
import { getToken } from './api.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Upload in pieces no larger than this. The server appends raw bytes in order,
// so splitting a blob and reassembling it yields an identical file. This keeps
// every request well under the server's body limit — important on Safari/iOS,
// which tends to emit the whole recording as one large blob at stop instead of
// honouring the timeslice.
const MAX_PART_BYTES = 4 * 1024 * 1024;

/** Outcome of trying to send one chunk. */
type SendResult = 'ok' | 'retry' | 'fatal';

/** A retry only helps for transient failures (network blips, rate limiting,
 * server errors). A 4xx like 400/413/415 will never succeed, so we stop. */
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * Uploads recording chunks to the server strictly in order. Chunks stay in the
 * queue until the server confirms them, so a brief network drop just means the
 * same chunk is retried — nothing is lost and order is preserved. A permanent
 * rejection marks the upload failed instead of retrying forever.
 */
export class ChunkUploader {
  private queue: Blob[] = [];
  private index = 0;
  private running = false;
  private done = false;
  private failed = false;

  constructor(private readonly recordingId: string) {}

  /** True once a chunk was rejected in a way retrying cannot fix. */
  get hasFailed(): boolean {
    return this.failed;
  }

  enqueue(chunk: Blob): void {
    if (this.failed) return;
    // Split large blobs into byte-range slices so no single request is too big.
    for (let start = 0; start < chunk.size; start += MAX_PART_BYTES) {
      this.queue.push(chunk.slice(start, Math.min(start + MAX_PART_BYTES, chunk.size)));
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.failed) {
        const result = await this.send(this.index, this.queue[0]!);
        if (result === 'ok') {
          this.queue.shift();
          this.index += 1;
        } else if (result === 'retry') {
          await delay(1000); // brief backoff, then retry the same chunk
        } else {
          // The server rejected the chunk for good; stop and surface it.
          this.failed = true;
          this.queue = [];
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async send(index: number, chunk: Blob): Promise<SendResult> {
    const token = getToken();
    if (!token) return 'retry';
    try {
      // Send the raw bytes (ArrayBuffer), not the Blob itself, so the request
      // carries our explicit application/octet-stream type. iOS Safari can
      // otherwise send a sliced-Blob body the server sees as the wrong content
      // type (or empty), which is why uploads there used to hang.
      const body = await chunk.arrayBuffer();
      const res = await fetch(`/api/recordings/${this.recordingId}/chunks?index=${index}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
        body,
      });
      // 200 covers both a fresh append and an idempotent retry of a chunk the
      // server already has (after a lost response).
      if (res.ok) return 'ok';
      return isRetryableStatus(res.status) ? 'retry' : 'fatal';
    } catch {
      return 'retry'; // network blip: keep the chunk and try again
    }
  }

  /**
   * Wait for the queue to drain, then mark the recording complete. Resolves
   * early (without completing) if a chunk failed permanently, leaving the
   * segment for the teacher to retry or delete.
   */
  async finish(
    mimeType: string,
    opts: { hasVideo: boolean; hasAudio: boolean; crop?: CropRect | null },
  ): Promise<void> {
    if (this.done) return;
    this.done = true;
    while ((this.queue.length > 0 || this.running) && !this.failed) await delay(200);
    if (this.failed) return;

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

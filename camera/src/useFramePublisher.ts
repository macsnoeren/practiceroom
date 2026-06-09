import { useEffect } from 'react';

const INTERVAL_MS = 2000;
const PREVIEW_WIDTH = 320;
const JPEG_QUALITY = 0.5;

/**
 * Periodically grabs a small JPEG snapshot from the stream's video track and
 * hands it to `send` (the dashboard shows these as a near-live preview). Does
 * nothing for audio-only streams. Lightweight: one downscaled frame every few
 * seconds, never a continuous video stream.
 */
export function useFramePublisher(
  stream: MediaStream | null,
  send: (dataUrl: string) => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!stream || !enabled) return;
    if (stream.getVideoTracks().length === 0) return;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const canvas = document.createElement('canvas');
    void video.play().catch(() => undefined);

    let stopped = false;
    const capture = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (stopped || !w || !h) return;
      canvas.width = PREVIEW_WIDTH;
      canvas.height = Math.round((PREVIEW_WIDTH * h) / w);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        send(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        // a not-yet-ready frame can throw; just skip this tick
      }
    };

    const timer = window.setInterval(capture, INTERVAL_MS);
    const first = window.setTimeout(capture, 500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
      video.srcObject = null;
    };
  }, [stream, send, enabled]);
}

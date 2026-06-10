import { useEffect } from 'react';

const INTERVAL_MS = 400;

/**
 * Measures the stream's live microphone level (0–1 RMS) and reports it via
 * `send` a few times per second, so the control room can show a level meter to
 * check the sound works. Does nothing for a stream without audio.
 */
export function useMicLevel(
  stream: MediaStream | null,
  send: (level: number) => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    void ctx.resume().catch(() => undefined);
    const buffer = new Float32Array(analyser.fftSize);

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      // A little headroom so normal speech reaches a visible level.
      send(Math.min(1, rms * 2.5));
    }, INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream, send, enabled]);
}

import { useEffect, useRef, useState } from 'react';

/**
 * Routes the stream's microphone through a Web Audio gain node so its volume can
 * be adjusted live (controlled remotely from the control room). Video tracks
 * pass through untouched. A stream without audio is returned unchanged.
 *
 * Returns the processed stream to record/preview; the `gain` (a 0–2 multiplier)
 * is applied live without rebuilding the graph.
 */
export function useMicGain(rawStream: MediaStream | null, gain: number): MediaStream | null {
  const [processed, setProcessed] = useState<MediaStream | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (!rawStream) {
      setProcessed(null);
      return;
    }
    const audioTracks = rawStream.getAudioTracks();
    if (audioTracks.length === 0) {
      gainNodeRef.current = null;
      setProcessed(rawStream); // nothing to gain (e.g. camera without sound)
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    const dest = ctx.createMediaStreamDestination();
    source.connect(gainNode).connect(dest);
    gainNodeRef.current = gainNode;
    void ctx.resume().catch(() => undefined);

    const out = new MediaStream([...rawStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    setProcessed(out);

    return () => {
      gainNodeRef.current = null;
      source.disconnect();
      gainNode.disconnect();
      void ctx.close().catch(() => undefined);
    };
    // Rebuild only when the source stream changes; gain is applied below.
  }, [rawStream]);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain;
  }, [gain]);

  return processed;
}

import { useEffect, useRef, useState } from 'react';
import { ChunkUploader } from './upload.js';

export type RecorderState = 'idle' | 'recording' | 'finishing' | 'error';

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Records the given stream into the active Recording while a recording command
 * is in effect. Starts when `recordingId` appears, stops (and finalises the
 * upload) when it clears. The stream is captured at start, so switching cameras
 * is disabled in the UI while recording.
 */
export function useRecorder(
  stream: MediaStream | null,
  activeRecording: { recordingId: string } | null,
): RecorderState {
  const [state, setState] = useState<RecorderState>('idle');
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const recordingId = activeRecording?.recordingId;

  useEffect(() => {
    if (!recordingId) return;
    const currentStream = streamRef.current;
    if (!currentStream) {
      setState('error');
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(currentStream, mimeType ? { mimeType } : undefined);
    } catch {
      setState('error');
      return;
    }

    const uploader = new ChunkUploader(recordingId);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) uploader.enqueue(event.data);
    };
    recorder.onstop = () => {
      setState('finishing');
      void uploader.finish(mimeType ?? 'video/webm').then(() => setState('idle'));
    };

    recorder.start(2000); // emit a chunk every 2 seconds
    setState('recording');

    return () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
  }, [recordingId]);

  return state;
}

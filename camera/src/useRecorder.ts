import { useEffect, useRef, useState } from 'react';
import type { CropRect } from '@practiceroom/shared';
import { ChunkUploader } from './upload.js';

export type RecorderState = 'idle' | 'recording' | 'finishing' | 'error';

// webm first (desktop Chrome/Firefox), then mp4 as a fallback for Safari/iOS,
// which does not support webm — there the recorder produces mp4 (H.264/AAC).
const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];

function pickMimeType(hasVideo: boolean): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = hasVideo ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
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
  crop: CropRect | null = null,
): RecorderState {
  const [state, setState] = useState<RecorderState>('idle');
  const streamRef = useRef(stream);
  streamRef.current = stream;
  // Read at stop time, so the latest chosen crop is the one that's saved.
  const cropRef = useRef(crop);
  cropRef.current = crop;

  const recordingId = activeRecording?.recordingId;

  useEffect(() => {
    if (!recordingId) return;
    const currentStream = streamRef.current;
    if (!currentStream) {
      setState('error');
      return;
    }

    const hasVideo = currentStream.getVideoTracks().length > 0;
    const hasAudio = currentStream.getAudioTracks().length > 0;
    const mimeType = pickMimeType(hasVideo);
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
      const fallback = hasVideo ? 'video/webm' : 'audio/webm';
      // Report the type the recorder actually produced (Safari/iOS picks mp4),
      // so the stored file is labelled correctly for playback.
      const actualType = recorder.mimeType || mimeType || fallback;
      // A crop only applies to a captured video frame.
      const crop = hasVideo ? cropRef.current : null;
      void uploader
        .finish(actualType, { hasVideo, hasAudio, crop })
        .then(() => setState(uploader.hasFailed ? 'error' : 'idle'));
    };

    // Report 'recording' only once capture has actually begun (onstart), not when
    // start() is merely called — so the control room and the sync-tone coordinator
    // wait for real frames before treating this camera as ready.
    recorder.onstart = () => setState('recording');
    recorder.start(2000); // emit a chunk every 2 seconds

    return () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
  }, [recordingId]);

  return state;
}

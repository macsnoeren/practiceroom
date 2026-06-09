import { useCallback, useEffect, useRef, useState } from 'react';

/** What the device captures: camera + microphone, microphone only, or camera
 * without sound. */
export type CaptureMode = 'both' | 'audio' | 'video';

const MODE_LABEL: Record<CaptureMode, string> = {
  both: 'Camera + microfoon',
  audio: 'Alleen microfoon',
  video: 'Camera zonder geluid',
};

/**
 * Live local preview of the selected inputs. The active stream is reported via
 * `onStream` so the recorder can use the exact same tracks. The capture mode
 * lets one device film with sound, capture only sound, or film without sound.
 * Switching is disabled while recording (it would stop the recording's tracks).
 */
export function CameraPreview({
  onStream,
  disabled = false,
}: {
  onStream: (stream: MediaStream | null) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoId, setVideoId] = useState('');
  const [audioId, setAudioId] = useState('');
  const [mode, setMode] = useState<CaptureMode>('both');
  const [error, setError] = useState<string | null>(null);

  const wantsVideo = mode !== 'audio';
  const wantsAudio = mode !== 'video';

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onStream(null);
  }, [onStream]);

  const start = useCallback(async () => {
    setError(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: wantsVideo ? (videoId ? { deviceId: { exact: videoId } } : true) : false,
        audio: wantsAudio ? (audioId ? { deviceId: { exact: audioId } } : true) : false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      onStream(stream);

      // Labels are only available once permission is granted.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoInputs(devices.filter((d) => d.kind === 'videoinput'));
      setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
    } catch {
      setError(
        'Geen toegang tot camera/microfoon. Geef toestemming in de browser en probeer opnieuw.',
      );
    }
  }, [wantsVideo, wantsAudio, videoId, audioId, stopStream, onStream]);

  useEffect(() => {
    void start();
    return stopStream;
  }, [start, stopStream]);

  return (
    <div>
      {wantsVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className="preview" />
      ) : (
        <div className="preview preview-audio">🎙️ Alleen geluid</div>
      )}

      {error && (
        <div>
          <p className="error">{error}</p>
          <button type="button" onClick={() => void start()}>
            Opnieuw proberen
          </button>
        </div>
      )}

      <label htmlFor="mode-select">Opnamemodus</label>
      <select
        id="mode-select"
        value={mode}
        disabled={disabled}
        onChange={(e) => setMode(e.target.value as CaptureMode)}
      >
        {(Object.keys(MODE_LABEL) as CaptureMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>

      {wantsVideo && videoInputs.length > 0 && (
        <>
          <label htmlFor="cam-select">Camera</label>
          <select
            id="cam-select"
            value={videoId}
            disabled={disabled}
            onChange={(e) => setVideoId(e.target.value)}
          >
            {videoInputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </>
      )}

      {wantsAudio && audioInputs.length > 0 && (
        <>
          <label htmlFor="mic-select">Microfoon</label>
          <select
            id="mic-select"
            value={audioId}
            disabled={disabled}
            onChange={(e) => setAudioId(e.target.value)}
          >
            {audioInputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microfoon ${i + 1}`}
              </option>
            ))}
          </select>
        </>
      )}

      <p className="muted">
        {wantsAudio
          ? 'De preview is gedempt om rondzingen te voorkomen; de microfoon wordt wel opgenomen.'
          : 'Dit apparaat neemt op zonder geluid.'}
        {disabled && ' Instellingen wijzigen kan niet tijdens een opname.'}
      </p>
    </div>
  );
}

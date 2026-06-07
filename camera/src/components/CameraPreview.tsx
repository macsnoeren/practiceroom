import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live local preview of the selected camera + microphone. The active stream is
 * reported via `onStream` so the recorder can use the exact same tracks.
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
  const [error, setError] = useState<string | null>(null);

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
        video: videoId ? { deviceId: { exact: videoId } } : true,
        audio: audioId ? { deviceId: { exact: audioId } } : true,
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
  }, [videoId, audioId, stopStream, onStream]);

  useEffect(() => {
    void start();
    return stopStream;
  }, [start, stopStream]);

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted className="preview" />

      {error && (
        <div>
          <p className="error">{error}</p>
          <button type="button" onClick={() => void start()}>
            Opnieuw proberen
          </button>
        </div>
      )}

      {videoInputs.length > 0 && (
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

      {audioInputs.length > 0 && (
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
        De preview is gedempt om rondzingen te voorkomen; de microfoon wordt wel opgenomen.
        {disabled && ' Camera/microfoon wisselen kan niet tijdens een opname.'}
      </p>
    </div>
  );
}

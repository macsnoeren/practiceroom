import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CropRect } from '@practiceroom/shared';

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
  onCrop,
  disabled = false,
}: {
  onStream: (stream: MediaStream | null) => void;
  onCrop?: (crop: CropRect | null) => void;
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

  // The crop rectangle (fractions of the frame) and an in-progress drag, both
  // as {x,y,w,h}. The committed crop is reported to the parent via onCrop.
  const cropLayerRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [drag, setDrag] = useState<CropRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const wantsVideo = mode !== 'audio';
  const wantsAudio = mode !== 'video';

  const reportCrop = useCallback(
    (next: CropRect | null) => {
      setCrop(next);
      onCrop?.(next);
    },
    [onCrop],
  );

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const pointFromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const rect = cropLayerRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const p = pointFromEvent(e);
    dragStart.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
    cropLayerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const p = pointFromEvent(e);
    const s = dragStart.current;
    setDrag({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  };

  const onPointerUp = () => {
    const d = drag;
    dragStart.current = null;
    setDrag(null);
    // Ignore an accidental tap or a sliver; require a meaningful rectangle.
    if (d && d.w >= 0.05 && d.h >= 0.05) reportCrop(d);
  };

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

  // A crop only makes sense with a camera; clear it when capturing audio only.
  useEffect(() => {
    if (!wantsVideo && crop) reportCrop(null);
  }, [wantsVideo, crop, reportCrop]);

  const box = drag ?? crop;

  return (
    <div>
      {wantsVideo ? (
        <div className="preview-wrap">
          <video ref={videoRef} autoPlay playsInline muted className="preview" />
          <div
            ref={cropLayerRef}
            className={`crop-layer${disabled ? ' disabled' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {box && (
              <div
                className="crop-rect"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="preview preview-audio">🎙️ Alleen geluid</div>
      )}

      {wantsVideo && (
        <div className="crop-controls">
          {crop ? (
            <p className="muted">
              Alleen het gekozen kader wordt opgenomen.{' '}
              <button
                type="button"
                className="secondary"
                onClick={() => reportCrop(null)}
                disabled={disabled}
              >
                Kader wissen
              </button>
            </p>
          ) : (
            <p className="muted">
              Sleep op het beeld om een kader te kiezen; alleen dat deel wordt opgenomen. Zonder
              kader wordt het hele beeld gebruikt.
            </p>
          )}
        </div>
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

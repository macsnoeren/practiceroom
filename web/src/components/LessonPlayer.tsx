import { useEffect, useState } from 'react';
import type { RecordingDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { SecureVideo } from './SecureVideo.js';

/**
 * Plays back the completed recordings of a lesson, one camera angle at a time.
 * The video src is a short-lived signed URL fetched per recording.
 */
export function LessonPlayer({
  recordings,
  deviceName,
}: {
  recordings: RecordingDto[];
  deviceName: (deviceId: string) => string;
}) {
  const completed = recordings.filter((r) => r.status === 'completed');
  const [selected, setSelected] = useState<string | null>(completed[0]?.id ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep a valid selection if the recordings change.
  useEffect(() => {
    if (completed.length > 0 && !completed.some((r) => r.id === selected)) {
      setSelected(completed[0]!.id);
    }
  }, [completed, selected]);

  useEffect(() => {
    if (!selected) {
      setUrl(null);
      return;
    }
    setError(null);
    api
      .getPlaybackUrl(selected)
      .then((res) => setUrl(res.url))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Kon de opname niet laden'),
      );
  }, [selected]);

  if (completed.length === 0) return null;

  return (
    <div>
      <h3>Opname terugkijken</h3>
      {completed.length > 1 && (
        <div className="angles">
          {completed.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`linkbtn${selected === r.id ? ' selected' : ''}`}
              onClick={() => setSelected(r.id)}
            >
              {deviceName(r.deviceId)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {url && <SecureVideo src={url} />}
    </div>
  );
}

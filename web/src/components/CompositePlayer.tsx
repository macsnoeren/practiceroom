import { useEffect, useState } from 'react';
import type { CompositeStatus, CompositeVideoDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { SecureVideo } from './SecureVideo.js';

/**
 * Plays the single combined lesson video once the worker has produced it.
 * While the video is still queued or being assembled, it polls for the status
 * so the page updates on its own — and the player appears as soon as it's
 * ready, without a manual refresh.
 */
export function CompositePlayer({
  lessonId,
  composite,
}: {
  lessonId: string;
  composite: CompositeVideoDto | null;
}) {
  const [status, setStatus] = useState<CompositeStatus | null>(composite?.status ?? null);
  const [errorText, setErrorText] = useState<string | null>(composite?.error ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Follow the parent if it reloads the lesson on its own.
  useEffect(() => {
    setStatus(composite?.status ?? null);
    setErrorText(composite?.error ?? null);
  }, [composite?.status, composite?.error]);

  // While the worker is still working, poll the lesson for the latest status.
  useEffect(() => {
    if (status !== 'queued' && status !== 'processing') return;
    let active = true;
    const tick = async () => {
      try {
        const lesson = await api.getLesson(lessonId);
        if (!active) return;
        setStatus(lesson.composite?.status ?? null);
        setErrorText(lesson.composite?.error ?? null);
      } catch {
        // Transient error: keep the current status and try again next tick.
      }
    };
    const interval = window.setInterval(tick, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [status, lessonId]);

  // Fetch a signed playback URL once the combined video is ready.
  useEffect(() => {
    if (status !== 'completed') {
      setUrl(null);
      return;
    }
    setLoadError(null);
    api
      .getCompositePlaybackUrl(lessonId)
      .then((res) => setUrl(res.url))
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiError ? err.message : 'Kon de lesvideo niet laden'),
      );
  }, [status, lessonId]);

  if (!status) return null;

  return (
    <div>
      <h3>Lesvideo (samengevoegd)</h3>
      {status === 'queued' && (
        <p className="muted">
          De lesvideo staat in de wachtrij om samengesteld te worden… deze pagina werkt zichzelf
          bij zodra hij klaar is.
        </p>
      )}
      {status === 'processing' && (
        <p className="muted">Bezig met samenstellen van de lesvideo…</p>
      )}
      {status === 'failed' && (
        <p className="error">Samenstellen mislukt{errorText ? `: ${errorText}` : ''}.</p>
      )}
      {loadError && <p className="error">{loadError}</p>}
      {url && <SecureVideo src={url} />}
    </div>
  );
}

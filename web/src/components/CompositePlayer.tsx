import { useEffect, useState } from 'react';
import type { CompositeVideoDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { SecureVideo } from './SecureVideo.js';

/** Plays the single combined lesson video once the worker has produced it. */
export function CompositePlayer({
  lessonId,
  composite,
}: {
  lessonId: string;
  composite: CompositeVideoDto | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completed = composite?.status === 'completed';

  useEffect(() => {
    if (!completed) {
      setUrl(null);
      return;
    }
    setError(null);
    api
      .getCompositePlaybackUrl(lessonId)
      .then((res) => setUrl(res.url))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Kon de lesvideo niet laden'),
      );
  }, [completed, lessonId]);

  if (!composite) return null;

  return (
    <div>
      <h3>Lesvideo (samengevoegd)</h3>
      {composite.status === 'queued' && (
        <p className="muted">De lesvideo staat in de wachtrij om samengesteld te worden…</p>
      )}
      {composite.status === 'processing' && (
        <p className="muted">Bezig met samenstellen van de lesvideo…</p>
      )}
      {composite.status === 'failed' && (
        <p className="error">
          Samenstellen mislukt{composite.error ? `: ${composite.error}` : ''}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {url && <SecureVideo src={url} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { SecureVideo } from './SecureVideo.js';

/** Plays a library video file via a short-lived signed URL. */
export function LibraryPlayer({ itemId }: { itemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .getLibraryPlaybackUrl(itemId)
      .then((res) => setUrl(res.url))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Kon de video niet laden'),
      );
  }, [itemId]);

  if (error) return <p className="error">{error}</p>;
  if (!url) return <p className="muted">Laden…</p>;
  return <SecureVideo src={url} />;
}

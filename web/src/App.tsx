import { useEffect, useState } from 'react';
import { APP_NAME, HealthResponseSchema, type HealthResponse } from '@practiceroom/shared';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((res) => res.json())
      .then((data: unknown) => {
        // Validate the server response against the shared contract.
        const health = HealthResponseSchema.parse(data);
        setStatus({ kind: 'ok', health });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus({ kind: 'error', message: String(err) });
      });

    return () => controller.abort();
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto' }}>
      <h1>{APP_NAME}</h1>
      <p>Fase 0 — fundament staat.</p>
      <section>
        <h2>Server-verbinding</h2>
        {status.kind === 'loading' && <p>Bezig met verbinden…</p>}
        {status.kind === 'ok' && (
          <p style={{ color: 'green' }}>
            ✅ Verbonden met {status.health.app} ({status.health.time})
          </p>
        )}
        {status.kind === 'error' && (
          <p style={{ color: 'crimson' }}>❌ Geen verbinding: {status.message}</p>
        )}
      </section>
    </main>
  );
}

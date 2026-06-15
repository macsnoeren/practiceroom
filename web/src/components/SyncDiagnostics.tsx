import type { CompositeVideoDto, SyncStreamReport } from '@practiceroom/shared';

const METHOD_LABEL = { tone: 'sync-toon', duration: 'duur (schatting)', none: 'geen' } as const;
const ROLE_LABEL: Record<string, string> = {
  main: 'hoofd',
  pip: 'inzet',
  audio: 'geluid',
  single: 'camera',
};

/**
 * Rates how reliably the tone was detected in one layer: a sharp rising edge
 * (small riseMs) and a clean, dominant tone mean a precise, repeatable onset.
 */
function toneQuality(s: SyncStreamReport): { label: string; color: string; title: string } | null {
  if (s.toneOnsetS === null) return null;
  const rise = s.toneRiseMs ?? null;
  const dom = s.toneDominance ?? null;
  const title = `flank ${rise === null ? '?' : `${rise} ms`}, sterkte ${
    dom === null ? '?' : `${Math.round(dom * 100)}%`
  }`;
  // Sharp edge + dominant tone → precise. Smeared/weak → unreliable.
  if (rise !== null && rise <= 30 && (dom ?? 0) >= 0.25)
    return { label: `scherp (${rise} ms)`, color: 'var(--ok, #4ade80)', title };
  if (rise !== null && rise <= 80 && (dom ?? 0) >= 0.12)
    return { label: `matig (${rise} ms)`, color: 'var(--accent, #f59e0b)', title };
  return {
    label: rise === null ? 'zwak' : `wazig (${rise} ms)`,
    color: 'var(--danger, #f06b6b)',
    title,
  };
}

/**
 * Shows, per segment of the combined video, how its layers were aligned: which
 * method (the recorded sync tone, a duration estimate, or none) and per stream
 * the detected tone onset, duration and the trim that was applied. Lets staff
 * see at a glance whether the audio/video sync actually locked onto the tone.
 */
export function SyncDiagnostics({
  sync,
  deviceName,
}: {
  sync: CompositeVideoDto['sync'];
  deviceName: (id: string) => string;
}) {
  if (!sync || sync.length === 0) return null;
  const fmt = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)}s`);

  return (
    <details className="sync-diag" style={{ marginTop: '1rem' }}>
      <summary>
        Sync-diagnose ({sync.length} segment{sync.length === 1 ? '' : 'en'})
      </summary>
      <p className="muted" style={{ marginTop: '0.5rem' }}>
        <strong>sync-toon</strong> = lagen exact uitgelijnd op de opgenomen toon ·{' '}
        <strong>duur</strong> = toon niet (overal) gedetecteerd, uitgelijnd op opnameduur (minder
        precies) · <strong>geen</strong> = enkele bron, geen uitlijning nodig.
      </p>
      <p className="muted">
        <strong>Kwaliteit</strong> = hoe scherp/betrouwbaar de toon-aanzet is (flank-rijstijd; korter
        = preciezer). Bouw een paar keer opnieuw en vergelijk de toon-tijden om de consistentie te
        zien.
      </p>
      {sync.map((seg) => (
        <div key={seg.segment} style={{ margin: '0.6rem 0' }}>
          <div className="muted">
            Segment {seg.segment} · uitlijning:{' '}
            <span className={`tag${seg.method === 'tone' ? ' tag-ok' : ''}`}>
              {METHOD_LABEL[seg.method]}
            </span>
            {seg.method === 'duration' && ' — toon niet in elke laag gevonden'}
          </div>
          <table style={{ width: '100%', fontSize: '0.82rem', marginTop: '0.25rem' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>laag</th>
                <th>apparaat</th>
                <th>toon</th>
                <th>kwaliteit</th>
                <th>duur</th>
                <th>trim</th>
              </tr>
            </thead>
            <tbody>
              {seg.streams.map((s, i) => {
                const q = toneQuality(s);
                return (
                  <tr key={i}>
                    <td>{ROLE_LABEL[s.role] ?? s.role}</td>
                    <td>
                      {deviceName(s.deviceId)}
                      {!s.hasAudio && <span className="muted"> · geen audio</span>}
                    </td>
                    <td>
                      {s.toneOnsetS === null ? (
                        <span className="muted">niet gevonden</span>
                      ) : (
                        fmt(s.toneOnsetS)
                      )}
                    </td>
                    <td>
                      {q ? (
                        <span style={{ color: q.color }} title={q.title}>
                          ● {q.label}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{fmt(s.durationS)}</td>
                    <td>{fmt(s.skipS)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

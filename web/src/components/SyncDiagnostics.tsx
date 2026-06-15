import type { CompositeVideoDto } from '@practiceroom/shared';

const METHOD_LABEL = { tone: 'sync-toon', duration: 'duur (schatting)', none: 'geen' } as const;
const ROLE_LABEL: Record<string, string> = {
  main: 'hoofd',
  pip: 'inzet',
  audio: 'geluid',
  single: 'camera',
};

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
                <th>duur</th>
                <th>trim</th>
              </tr>
            </thead>
            <tbody>
              {seg.streams.map((s, i) => (
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
                  <td>{fmt(s.durationS)}</td>
                  <td>{fmt(s.skipS)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

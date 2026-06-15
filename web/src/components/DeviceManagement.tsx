import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateDeviceSchema, type DeviceDto, type DeviceKind, type RoomDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { usePresence } from '../usePresence.js';
import { Modal } from './Modal.js';

interface PairingCode {
  code: string;
  expiresAt: string;
}

function CodeBox({ code, expiresAt }: PairingCode) {
  return (
    <div className="codebox">
      <div className="muted">Koppelcode (open de camera-app en voer deze in):</div>
      <div className="code">{code}</div>
      <div className="muted">
        Geldig tot {new Date(expiresAt).toLocaleTimeString()}. Camera-app:{' '}
        <code>http://localhost:5174</code>
      </div>
    </div>
  );
}

export function DeviceManagement() {
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<(PairingCode & { deviceId: string }) | null>(null);
  const [open, setOpen] = useState(false);
  const { online, statuses } = usePresence();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDevices(await api.listDevices());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.listRooms().then(setRooms).catch(() => undefined);
  }, [refresh]);

  // Assign a device to a room (or none), keeping the table in sync.
  async function setRoom(id: string, roomId: string | null) {
    setError(null);
    try {
      await api.updateDevice(id, { roomId });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lokaal koppelen mislukt');
    }
  }

  // Mark/unmark a device as its room's audio source (one per room).
  async function setAudioSource(id: string, isAudioSource: boolean) {
    setError(null);
    try {
      await api.updateDevice(id, { isAudioSource });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Geluidsbron instellen mislukt');
    }
  }

  // Calibrate a device's video offset (ms its video lags its audio).
  async function setVideoOffset(id: string, videoOffsetMs: number) {
    setError(null);
    try {
      await api.updateDevice(id, { videoOffsetMs: Math.max(-2000, Math.min(2000, videoOffsetMs)) });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Video-offset instellen mislukt');
    }
  }

  async function regenerate(id: string) {
    setError(null);
    try {
      const result = await api.regeneratePairingCode(id);
      setActiveCode({ deviceId: id, code: result.pairingCode, expiresAt: result.pairingExpiresAt });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Koppelcode genereren mislukt');
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Koppeling intrekken? Het apparaat moet daarna opnieuw koppelen.')) return;
    try {
      await api.revokeDevice(id);
      if (activeCode?.deviceId === id) setActiveCode(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Intrekken mislukt');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Apparaat definitief verwijderen?')) return;
    try {
      await api.deleteDevice(id);
      if (activeCode?.deviceId === id) setActiveCode(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Camera&rsquo;s &amp; microfoons</h2>
        <button
          type="button"
          onClick={() => {
            setActiveCode(null);
            setOpen(true);
          }}
        >
          + Apparaat toevoegen
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Pairing code shown after regenerating it for an existing device. */}
      {activeCode && <CodeBox code={activeCode.code} expiresAt={activeCode.expiresAt} />}

      {!devices && !error && <p className="muted">Laden…</p>}
      {devices && devices.length === 0 && <p className="muted">Nog geen apparaten.</p>}
      {devices && devices.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>Lokaal</th>
              <th>Geluidsbron</th>
              <th>Video-offset</th>
              <th>Status</th>
              <th>Live</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const isOnline = online.has(d.id);
              const state = statuses[d.id];
              return (
                <tr key={d.id}>
                  <td>
                    {d.name}{' '}
                    {d.kind === 'speaker' && <span className="tag" title="Speaker">🔊 speaker</span>}
                  </td>
                  <td>
                    <select
                      value={d.roomId ?? ''}
                      onChange={(e) => void setRoom(d.id, e.target.value || null)}
                      aria-label={`Lokaal voor ${d.name}`}
                    >
                      <option value="">— geen —</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {d.kind === 'speaker' ? (
                      <span className="muted">—</span>
                    ) : (
                      <label className="muted" title="Geluid van deze bron komt onder alle video's van dit lokaal">
                        <input
                          type="checkbox"
                          checked={d.isAudioSource}
                          disabled={!d.roomId}
                          onChange={(e) => void setAudioSource(d.id, e.target.checked)}
                        />{' '}
                        🎙
                      </label>
                    )}
                  </td>
                  <td>
                    {d.kind === 'speaker' ? (
                      <span className="muted">—</span>
                    ) : (
                      <input
                        key={`vo-${d.id}-${d.videoOffsetMs}`}
                        type="number"
                        step={10}
                        defaultValue={d.videoOffsetMs}
                        style={{ width: '5rem' }}
                        title="ms dat het beeld van dit apparaat achterloopt op het geluid (positief = beeld wordt vooruitgehaald)"
                        aria-label={`Video-offset in ms voor ${d.name}`}
                        onBlur={(e) => {
                          const v = Math.round(Number(e.target.value) || 0);
                          if (v !== d.videoOffsetMs) void setVideoOffset(d.id, v);
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {d.paired ? (
                      <span className="tag tag-ok">gekoppeld</span>
                    ) : (
                      <span className="tag">niet gekoppeld</span>
                    )}
                  </td>
                  <td>
                    {isOnline && state === 'error' ? (
                      <span className="tag" title="Apparaat is verbonden maar de camera is niet aangesloten">
                        ⚠ niet aangesloten
                      </span>
                    ) : isOnline ? (
                      <span className="tag tag-ok">● online{state ? ` (${state})` : ''}</span>
                    ) : (
                      <span className="tag">offline</span>
                    )}
                  </td>
                  <td className="actions">
                    {!d.paired && (
                      <button type="button" className="linkbtn" onClick={() => regenerate(d.id)}>
                        Koppelcode
                      </button>
                    )}
                    {d.paired && (
                      <button type="button" className="linkbtn" onClick={() => revoke(d.id)}>
                        Intrekken
                      </button>
                    )}
                    <button type="button" className="linkbtn danger" onClick={() => remove(d.id)}>
                      Verwijderen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {open && (
        <Modal title="Apparaat toevoegen" onClose={() => setOpen(false)}>
          <AddDeviceForm onCreated={refresh} />
        </Modal>
      )}
    </div>
  );
}

function AddDeviceForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('camera');
  const [created, setCreated] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateDeviceSchema.safeParse({ name, kind });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de naam');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createDevice(parsed.data.name, parsed.data.kind);
      setCreated({ code: result.pairingCode, expiresAt: result.pairingExpiresAt });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  // After creation, show the pairing code to enter in the camera/speaker app.
  if (created) {
    return (
      <div>
        <p className="muted">
          Apparaat toegevoegd. Open de {kind === 'speaker' ? 'speaker' : 'camera'}-app en voer deze
          koppelcode in:
        </p>
        <CodeBox code={created.code} expiresAt={created.expiresAt} />
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="dev-kind">Type</label>
      <select id="dev-kind" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
        <option value="camera">Camera</option>
        <option value="speaker">Speaker (sync-toon)</option>
      </select>
      <label htmlFor="dev-name">Naam apparaat (bijv. &ldquo;Lokaal 1 — voorkant&rdquo;)</label>
      <input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Apparaat toevoegen'}
      </button>
    </form>
  );
}

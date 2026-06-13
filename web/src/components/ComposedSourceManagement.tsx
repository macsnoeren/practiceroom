import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PIP_POSITIONS,
  PIP_SIZE_NAMES,
  type ComposedSourceDto,
  type DeviceDto,
  type PipPosition,
  type PipSize,
  type RoomDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { Modal } from './Modal.js';

const POSITION_LABELS: Record<PipPosition, string> = {
  'bottom-left': 'Linksonder',
  'bottom-right': 'Rechtsonder',
  'top-left': 'Linksboven',
  'top-right': 'Rechtsboven',
};

const SIZE_LABELS: Record<PipSize, string> = {
  small: 'Klein',
  medium: 'Middel',
  large: 'Groot',
};

const MAX_INSETS = 3;

export function ComposedSourceManagement() {
  const [sources, setSources] = useState<ComposedSourceDto[] | null>(null);
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSources(await api.listComposedSources());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.listRooms().then(setRooms).catch(() => undefined);
    api.listDevices().then(setDevices).catch(() => undefined);
  }, [refresh]);

  async function remove(id: string) {
    if (!window.confirm('Samengestelde bron verwijderen?')) return;
    try {
      await api.deleteComposedSource(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '—';
  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? 'Camera';

  return (
    <div className="card">
      <div className="row">
        <h2>Samengestelde bronnen</h2>
        <button type="button" onClick={() => setOpen(true)} disabled={rooms.length === 0}>
          + Bron toevoegen
        </button>
      </div>
      <p className="muted">
        Combineer meerdere camera&rsquo;s van een lokaal tot één bron: een hoofdcamera met andere
        camera&rsquo;s als inzet in een hoek (bijv. een voetencamera linksonder).
      </p>

      {error && <p className="error">{error}</p>}

      {!sources && <p className="muted">Laden…</p>}
      {sources && sources.length === 0 && <p className="muted">Nog geen samengestelde bronnen.</p>}
      {sources && sources.length > 0 && (
        <ul className="material-list">
          {sources.map((s) => {
            const main = s.members.find((m) => m.role === 'main');
            const pips = s.members.filter((m) => m.role === 'pip');
            return (
              <li key={s.id}>
                <div>
                  <strong>{s.name}</strong> <span className="muted">· {roomName(s.roomId)}</span>
                  <div className="muted">
                    Hoofd: {main ? deviceName(main.deviceId) : '—'}
                    {pips.map((p) => (
                      <span key={p.deviceId}>
                        {' · '}
                        {deviceName(p.deviceId)} ({p.position ? POSITION_LABELS[p.position] : ''})
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" className="linkbtn danger" onClick={() => remove(s.id)}>
                  Verwijderen
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <Modal title="Samengestelde bron toevoegen" onClose={() => setOpen(false)}>
          <SourceForm
            rooms={rooms}
            devices={devices}
            onCreated={() => {
              setOpen(false);
              void refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

interface Inset {
  deviceId: string;
  position: PipPosition;
  size: PipSize;
}

function SourceForm({
  rooms,
  devices,
  onCreated,
}: {
  rooms: RoomDto[];
  devices: DeviceDto[];
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [mainDeviceId, setMainDeviceId] = useState('');
  const [insets, setInsets] = useState<Inset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cameras of the chosen room (the audio source is not a video camera).
  const roomCameras = devices.filter((d) => d.roomId === roomId && !d.isAudioSource);
  // Cameras still available for an inset (not the main, not already chosen).
  const usedIds = new Set([mainDeviceId, ...insets.map((i) => i.deviceId)]);
  const availableForInset = roomCameras.filter((d) => !usedIds.has(d.id));

  function addInset() {
    const next = availableForInset[0];
    if (!next) return;
    setInsets((prev) => [...prev, { deviceId: next.id, position: 'bottom-left', size: 'medium' }]);
  }

  function updateInset(idx: number, patch: Partial<Inset>) {
    setInsets((prev) => prev.map((i, n) => (n === idx ? { ...i, ...patch } : i)));
  }

  function removeInset(idx: number) {
    setInsets((prev) => prev.filter((_, n) => n !== idx));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !roomId || !mainDeviceId) {
      setError('Geef een naam, lokaal en hoofdcamera op.');
      return;
    }
    setBusy(true);
    try {
      await api.createComposedSource({
        name: name.trim(),
        roomId,
        members: [
          { deviceId: mainDeviceId, role: 'main' as const },
          ...insets.map((i) => ({
            deviceId: i.deviceId,
            role: 'pip' as const,
            position: i.position,
            size: i.size,
          })),
        ],
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="src-name">Naam (bijv. &ldquo;Overzicht + voet&rdquo;)</label>
      <input id="src-name" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="src-room">Lokaal</label>
      <select
        id="src-room"
        value={roomId}
        onChange={(e) => {
          setRoomId(e.target.value);
          setMainDeviceId('');
          setInsets([]);
        }}
      >
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      <label htmlFor="src-main">Hoofdcamera</label>
      <select
        id="src-main"
        value={mainDeviceId}
        onChange={(e) => {
          setMainDeviceId(e.target.value);
          setInsets((prev) => prev.filter((i) => i.deviceId !== e.target.value));
        }}
      >
        <option value="">— kies —</option>
        {roomCameras.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <div style={{ marginTop: '0.75rem' }}>
        <strong>Inzetcamera&rsquo;s</strong>
        {insets.length === 0 && <p className="muted">Nog geen inzet toegevoegd.</p>}
        {insets.map((inset, idx) => (
          <div
            key={idx}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.35rem 0' }}
          >
            <select
              value={inset.deviceId}
              onChange={(e) => updateInset(idx, { deviceId: e.target.value })}
              aria-label="Inzetcamera"
            >
              {roomCameras
                .filter((d) => d.id === inset.deviceId || !usedIds.has(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            <select
              value={inset.position}
              onChange={(e) => updateInset(idx, { position: e.target.value as PipPosition })}
              aria-label="Hoek"
            >
              {PIP_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_LABELS[p]}
                </option>
              ))}
            </select>
            <select
              value={inset.size}
              onChange={(e) => updateInset(idx, { size: e.target.value as PipSize })}
              aria-label="Grootte"
            >
              {PIP_SIZE_NAMES.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABELS[s]}
                </option>
              ))}
            </select>
            <button type="button" className="linkbtn danger" onClick={() => removeInset(idx)}>
              Verwijderen
            </button>
          </div>
        ))}
        {insets.length < MAX_INSETS && availableForInset.length > 0 && mainDeviceId && (
          <button type="button" className="linkbtn" onClick={addInset}>
            + Inzetcamera
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="recording-buttons" style={{ marginTop: '0.75rem' }}>
        <button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Bron opslaan'}
        </button>
      </div>
    </form>
  );
}

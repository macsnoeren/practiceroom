import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CreateMaterialSchema,
  type DeviceDto,
  type LessonDetailDto,
  type RoomDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes, formatWhen } from '../format.js';
import { usePresence } from '../usePresence.js';
import { CompositePlayer } from './CompositePlayer.js';
import { LessonPlayer } from './LessonPlayer.js';

/** Full per-lesson dashboard for staff: cameras, recording, notes, playback. */
export function LessonDashboard() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { online } = usePresence();

  const [detail, setDetail] = useState<LessonDetailDto | null>(null);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.getLesson(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, [id]);

  useEffect(() => {
    void load();
    void api.listDevices().then(setDevices);
    void api
      .listRooms()
      .then(setRooms)
      .catch(() => undefined);
  }, [load]);

  const deviceName = (deviceId: string) =>
    detail?.devices.find((d) => d.id === deviceId)?.name ?? 'Camera';

  async function run(action: () => Promise<unknown>, failMsg: string) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMsg);
    }
  }

  async function toggleDevice(deviceId: string, checked: boolean) {
    if (!detail) return;
    const ids = new Set(detail.devices.map((d) => d.id));
    if (checked) ids.add(deviceId);
    else ids.delete(deviceId);
    await run(() => api.setLessonDevices(id, [...ids]), 'Opslaan mislukt');
  }

  async function removeLesson(series: boolean) {
    const msg = series ? 'De hele wekelijkse reeks verwijderen?' : 'Les verwijderen?';
    if (!window.confirm(msg)) return;
    try {
      await api.deleteLesson(id, series);
      navigate('/lessons');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  if (error && !detail) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Laden…</p>;

  const finished = detail.status === 'recorded' || detail.status === 'ready';
  const activeDeviceId = detail.recordings.find((r) => r.status === 'recording')?.deviceId ?? null;

  return (
    <div>
      <p>
        <Link to="/lessons">← Terug naar lessen</Link>
      </p>

      <div className="card">
        <div className="row">
          <div>
            <h2>{detail.title || 'Les'}</h2>
            <div className="muted">
              {formatWhen(detail.startsAt)} · {detail.durationMinutes} min · student{' '}
              {detail.student.name} · leraar {detail.teacher.name}
              {detail.seriesId ? ' · onderdeel van een wekelijkse reeks' : ''}
            </div>
          </div>
          <span className="tag">{detail.status}</span>
        </div>

        <label htmlFor="lesson-room">Lokaal</label>
        <select
          id="lesson-room"
          value={detail.room?.id ?? ''}
          onChange={(e) =>
            run(() => api.updateLesson(id, { roomId: e.target.value || null }), 'Opslaan mislukt')
          }
        >
          <option value="">— geen lokaal —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Camera&rsquo;s</h2>
        {devices.length === 0 && <p className="muted">Nog geen apparaten geregistreerd.</p>}
        <p className="muted">Kies welke camera&rsquo;s bij deze les horen:</p>
        {devices.map((d) => (
          <label key={d.id} className="checkbox">
            <input
              type="checkbox"
              checked={detail.devices.some((x) => x.id === d.id)}
              onChange={(e) => toggleDevice(d.id, e.target.checked)}
            />
            {d.name}
            {online.has(d.id) && <span className="tag tag-ok">● online</span>}
          </label>
        ))}

        <h3>Opname</h3>
        {finished ? (
          <p className="muted">Deze les is afgerond — opnemen is niet meer mogelijk.</p>
        ) : (
          <>
            <p className="muted">
              Eén camera tegelijk. Klik je een andere camera, dan gaat de opname over naar die
              camera. Met &ldquo;Les afronden&rdquo; maak je er één video van.
            </p>
            {detail.devices.length === 0 && (
              <p className="muted">Selecteer hierboven eerst camera&rsquo;s.</p>
            )}
            <div className="camera-controls">
              {detail.devices.map((d) => {
                const isOnline = online.has(d.id);
                const isActive = activeDeviceId === d.id;
                return (
                  <div key={d.id} className="camera-row">
                    <span>
                      {d.name}{' '}
                      {isActive ? (
                        <span className="tag rec">● opname</span>
                      ) : isOnline ? (
                        <span className="tag tag-ok">online</span>
                      ) : (
                        <span className="tag">offline</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => run(() => api.startRecording(id, d.id), 'Starten mislukt')}
                      disabled={!isOnline || isActive}
                    >
                      {activeDeviceId ? 'Wissel hierheen' : 'Start'}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="recording-buttons">
              {activeDeviceId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => run(() => api.stopRecording(id), 'Stoppen mislukt')}
                >
                  Stop ({deviceName(activeDeviceId)})
                </button>
              )}
              <button
                type="button"
                onClick={() => run(() => api.finishRecording(id), 'Afronden mislukt')}
                disabled={detail.recordings.length === 0}
              >
                Les afronden &amp; video maken
              </button>
              <button type="button" className="linkbtn" onClick={() => void load()}>
                Vernieuwen
              </button>
            </div>
          </>
        )}

        {detail.recordings.length > 0 && (
          <ul className="material-list">
            {detail.recordings.map((r, i) => (
              <li key={r.id}>
                <div>
                  Segment {i + 1}: {deviceName(r.deviceId)} <span className="tag">{r.status}</span>{' '}
                  {r.sizeBytes > 0 && <span className="muted">{formatBytes(r.sizeBytes)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <CompositePlayer lessonId={id} composite={detail.composite} />
        <LessonPlayer recordings={detail.recordings} deviceName={deviceName} />
        {detail.composite === null && detail.recordings.length === 0 && (
          <p className="muted">Nog geen opnames.</p>
        )}
      </div>

      <div className="card">
        <h2>Aantekeningen</h2>
        <NotesEditor lessonId={id} initialNotes={detail.notes} />
      </div>

      <div className="card">
        <h2>Lesmateriaal</h2>
        <MaterialList detail={detail} onChanged={load} />
        <MaterialForm lessonId={id} onAdded={load} />
      </div>

      <div className="card">
        <div className="lesson-actions">
          <button type="button" className="linkbtn danger" onClick={() => removeLesson(false)}>
            Les verwijderen
          </button>
          {detail.seriesId && (
            <button type="button" className="linkbtn danger" onClick={() => removeLesson(true)}>
              Hele reeks verwijderen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesEditor({
  lessonId,
  initialNotes,
}: {
  lessonId: string;
  initialNotes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setStatus('saving');
    try {
      await api.updateLesson(lessonId, { notes: notes.trim() || null });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div>
      <textarea
        rows={5}
        value={notes}
        placeholder="Aantekeningen bij deze les…"
        onChange={(e) => {
          setNotes(e.target.value);
          setStatus('idle');
        }}
      />
      <button type="button" onClick={save} disabled={status === 'saving'}>
        {status === 'saving' ? 'Opslaan…' : 'Aantekeningen opslaan'}
      </button>
      {status === 'saved' && <span className="success"> Opgeslagen.</span>}
      {status === 'error' && <span className="error"> Opslaan mislukt.</span>}
    </div>
  );
}

function MaterialList({ detail, onChanged }: { detail: LessonDetailDto; onChanged: () => void }) {
  if (detail.materials.length === 0) return <p className="muted">Nog geen materiaal.</p>;
  return (
    <ul className="material-list">
      {detail.materials.map((m) => (
        <li key={m.id}>
          <div>
            <strong>{m.title}</strong>
            {m.url && (
              <>
                {' '}
                <a href={m.url} target="_blank" rel="noreferrer">
                  link
                </a>
              </>
            )}
            {m.note && <div className="muted">{m.note}</div>}
          </div>
          <button
            type="button"
            className="linkbtn danger"
            onClick={async () => {
              await api.deleteMaterial(detail.id, m.id);
              onChanged();
            }}
          >
            x
          </button>
        </li>
      ))}
    </ul>
  );
}

function MaterialForm({ lessonId, onAdded }: { lessonId: string; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateMaterialSchema.safeParse({
      title,
      url: url || undefined,
      note: note || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de invoer');
      return;
    }
    try {
      await api.addMaterial(lessonId, parsed.data);
      setTitle('');
      setUrl('');
      setNote('');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    }
  }

  return (
    <form onSubmit={submit} className="material-form">
      <input
        placeholder="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <input
        placeholder="Link (https://…)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Link"
      />
      <input
        placeholder="Notitie"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Notitie"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit">Materiaal toevoegen</button>
    </form>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CreateMaterialSchema,
  type DeviceDto,
  type LessonDetailDto,
  type LibraryItemDto,
  type RoomDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes, formatWhen } from '../format.js';
import { usePresence } from '../usePresence.js';
import { CompositePlayer } from './CompositePlayer.js';
import { LessonPlayer } from './LessonPlayer.js';
import { MaterialView } from './MaterialView.js';

/** Full per-lesson dashboard for staff: cameras, recording, notes, playback. */
export function LessonDashboard() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { online, statuses, frames } = usePresence({ collectFrames: true });

  const [detail, setDetail] = useState<LessonDetailDto | null>(null);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Optimistic intent: a deviceId while we want it recording, null while we
  // want it stopped, undefined when we just follow the live truth.
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const autoSelectedRef = useRef(false);

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

  // Default: attach every registered camera to the lesson the first time we see
  // a lesson with none selected yet.
  useEffect(() => {
    if (autoSelectedRef.current || !detail) return;
    const finishedNow = detail.status === 'recorded' || detail.status === 'ready';
    if (!finishedNow && detail.devices.length === 0 && devices.length > 0) {
      autoSelectedRef.current = true;
      api
        .setLessonDevices(
          id,
          devices.map((d) => d.id),
        )
        .then(load)
        .catch(() => undefined);
    }
  }, [detail, devices, id, load]);

  // Which camera is *really* recording: prefer the camera's own live status
  // (near-instant over the socket), then fall back to the latest open segment
  // (e.g. when opening the page mid-session). The DB status of older segments
  // lags because a stopped camera only finalises after it finishes uploading.
  const liveActiveId = useMemo(() => {
    if (!detail) return null;
    const ids = new Set(detail.devices.map((d) => d.id));
    const reporting = Object.keys(statuses).find(
      (dev) => ids.has(dev) && statuses[dev] === 'recording',
    );
    if (reporting) return reporting;
    return [...detail.recordings].reverse().find((r) => r.status === 'recording')?.deviceId ?? null;
  }, [detail, statuses]);

  // Drop the optimistic guess once the live state agrees with it.
  useEffect(() => {
    if (pending !== undefined && liveActiveId === pending) setPending(undefined);
  }, [liveActiveId, pending]);

  const activeId = pending !== undefined ? pending : liveActiveId;

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

  async function startOn(deviceId: string) {
    setError(null);
    setPending(deviceId); // light up the new tile immediately
    try {
      await api.startRecording(id, deviceId);
      await load();
    } catch (err) {
      setPending(undefined);
      setError(err instanceof ApiError ? err.message : 'Starten mislukt');
    }
  }

  async function stopActive() {
    setError(null);
    setPending(null); // clear the active tile immediately
    try {
      await api.stopRecording(id);
      await load();
    } catch (err) {
      setPending(undefined);
      setError(err instanceof ApiError ? err.message : 'Stoppen mislukt');
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

  return (
    <div>
      <div className="card control-room">
        <div className="row">
          <div>
            <h2>Regiekamer</h2>
            <div className="muted">{detail.title || 'Les'}</div>
          </div>
          {activeId ? (
            <span className="tag rec">● opname loopt</span>
          ) : (
            <span className="tag">standby</span>
          )}
        </div>

        {finished ? (
          <p className="muted">Deze les is afgerond — opnemen is niet meer mogelijk.</p>
        ) : (
          <p className="muted">
            Klik op een camera om de opname te starten. Klik nog eens om te stoppen, of klik een
            andere camera om over te schakelen. Eén camera tegelijk; &ldquo;Les afronden&rdquo;
            maakt er één video van.
          </p>
        )}

        {detail.devices.length === 0 ? (
          <p className="muted">
            Nog geen camera&rsquo;s aan deze les gekoppeld — kies ze hieronder.
          </p>
        ) : (
          <div className="cam-grid">
            {detail.devices.map((d) => {
              const isOnline = online.has(d.id);
              const isActive = activeId === d.id;
              const frame = frames[d.id];
              const clickable = !finished && (isOnline || isActive);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`cam-tile${isActive ? ' recording' : ''}${isOnline ? '' : ' offline'}`}
                  disabled={!clickable}
                  onClick={() => (isActive ? void stopActive() : void startOn(d.id))}
                >
                  {frame ? (
                    <img className="cam-tile-img" src={frame} alt={`Beeld van ${d.name}`} />
                  ) : (
                    <div className="cam-tile-img placeholder">
                      {isOnline ? 'Wachten op beeld…' : 'Offline'}
                    </div>
                  )}
                  <div className="cam-tile-bar">
                    <span className="cam-tile-name">{d.name}</span>
                    {isActive ? (
                      <span className="tag rec">● REC</span>
                    ) : isOnline ? (
                      <span className="tag tag-ok">● online</span>
                    ) : (
                      <span className="tag">offline</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!finished && (
          <div className="recording-buttons">
            {activeId && (
              <button type="button" className="secondary" onClick={() => void stopActive()}>
                Stop ({deviceName(activeId)})
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
        )}

        {error && <p className="error">{error}</p>}

        <details className="cam-picker">
          <summary>Camera&rsquo;s kiezen</summary>
          {devices.length === 0 && <p className="muted">Nog geen apparaten geregistreerd.</p>}
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
        </details>

        {detail.recordings.length > 0 && (
          <ul className="material-list">
            {detail.recordings.map((r, i) => (
              <li key={r.id}>
                <div>
                  Segment {i + 1}: {deviceName(r.deviceId)} <span className="tag">{r.status}</span>{' '}
                  {!r.hasVideo && <span className="tag">alleen geluid</span>}
                  {r.hasVideo && !r.hasAudio && <span className="tag">zonder geluid</span>}{' '}
                  {r.sizeBytes > 0 && <span className="muted">{formatBytes(r.sizeBytes)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Aantekeningen &amp; tags</h2>
        <NotesEditor lessonId={id} initialNotes={detail.notes} />
        {detail.studentNotes && (
          <div className="student-notes">
            <h3>Aantekeningen van de student</h3>
            <p>{detail.studentNotes}</p>
          </div>
        )}
        <TagsPanel detail={detail} onChanged={load} />
      </div>

      <div className="card">
        <CompositePlayer lessonId={id} composite={detail.composite} />
        <LessonPlayer recordings={detail.recordings} deviceName={deviceName} />
        {detail.composite === null && detail.recordings.length === 0 && (
          <p className="muted">Nog geen opnames.</p>
        )}
        {detail.composite?.status === 'completed' && <SaveToLibrary lessonId={id} />}
      </div>

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
      </div>

      <div className="card">
        <h2>Lesmateriaal</h2>
        <MaterialList detail={detail} onChanged={load} />
        <MaterialForm lessonId={id} onAdded={load} />
        <AttachFromLibrary lessonId={id} onAttached={load} />
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

function formatTagTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Timeline markers placed during the lesson, kept for later review/editing. */
function TagsPanel({ detail, onChanged }: { detail: LessonDetailDto; onChanged: () => void }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addTag(e: FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.addTag(detail.id, trimmed);
      setLabel('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tag toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tags-panel">
      <h3>Tags (tijdstippen)</h3>
      <p className="muted">
        Markeer momenten tijdens de les. Het tijdstip wordt vastgelegd; later bruikbaar om in de
        video te knippen.
      </p>
      <form onSubmit={addTag} className="tag-form">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="bijv. mooi stuk, fout in maat 12…"
          aria-label="Tag"
        />
        <button type="submit" disabled={busy || !label.trim()}>
          + Tag nu
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {detail.tags.length === 0 ? (
        <p className="muted">Nog geen tags.</p>
      ) : (
        <ul className="tag-list">
          {detail.tags.map((t) => (
            <li key={t.id}>
              <span className="tag-time">{formatTagTime(t.at)}</span>
              <span className="tag-label">{t.label}</span>
              <button
                type="button"
                className="linkbtn danger"
                aria-label="Tag verwijderen"
                onClick={async () => {
                  await api.deleteTag(detail.id, t.id);
                  onChanged();
                }}
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialList({ detail, onChanged }: { detail: LessonDetailDto; onChanged: () => void }) {
  if (detail.materials.length === 0) return <p className="muted">Nog geen materiaal.</p>;
  return (
    <ul className="material-list">
      {detail.materials.map((m) => (
        <MaterialView
          key={m.id}
          material={m}
          onDelete={async () => {
            await api.deleteMaterial(detail.id, m.id);
            onChanged();
          }}
        />
      ))}
    </ul>
  );
}

/** Save the lesson's combined video into the teacher's own library. */
function SaveToLibrary({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setStatus('saving');
    try {
      await api.saveLessonToLibrary(lessonId, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setStatus('saved');
      setOpen(false);
      setTitle('');
      setDescription('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="save-to-library">
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Opslaan in mijn bibliotheek
        </button>
      ) : (
        <form onSubmit={save} className="material-form">
          <input
            placeholder="Titel voor de bibliotheek"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Titel"
          />
          <input
            placeholder="Beschrijving (optioneel)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Beschrijving"
          />
          <button type="submit" disabled={status === 'saving'}>
            {status === 'saving' ? 'Opslaan…' : 'Opslaan'}
          </button>
          <button type="button" className="linkbtn" onClick={() => setOpen(false)}>
            Annuleren
          </button>
        </form>
      )}
      {status === 'saved' && <span className="success"> Opgeslagen in je bibliotheek.</span>}
      {status === 'error' && <span className="error"> Opslaan mislukt.</span>}
    </div>
  );
}

/** Attach a video from the teacher's library to this lesson. */
function AttachFromLibrary({ lessonId, onAttached }: { lessonId: string; onAttached: () => void }) {
  const [items, setItems] = useState<LibraryItemDto[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listLibrary()
      .then(setItems)
      .catch(() => undefined);
  }, []);

  async function attach() {
    if (!selected) return;
    setError(null);
    try {
      await api.attachLibraryToLesson(lessonId, selected);
      setSelected('');
      onAttached();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Koppelen mislukt');
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="attach-library">
      <label htmlFor="attach-lib">Uit mijn bibliotheek toevoegen</label>
      <div className="row">
        <select id="attach-lib" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— kies een video —</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.title}
              {it.kind === 'link' ? ' (link)' : ''}
            </option>
          ))}
        </select>
        <button type="button" onClick={attach} disabled={!selected}>
          Toevoegen
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
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

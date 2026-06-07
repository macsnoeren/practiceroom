import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CreateLessonSchema,
  CreateMaterialSchema,
  type DeviceDto,
  type LessonDetailDto,
  type LessonDto,
  type UserDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes, formatWhen } from '../format.js';
import { usePresence } from '../usePresence.js';

export function LessonManagement({ isAdmin }: { isAdmin: boolean }) {
  const [lessons, setLessons] = useState<LessonDto[] | null>(null);
  const [students, setStudents] = useState<UserDto[]>([]);
  const [teachers, setTeachers] = useState<UserDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLessons = useCallback(async () => {
    setError(null);
    try {
      setLessons(await api.listLessons());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refreshLessons();
    void api.listUsers().then((users) => {
      setStudents(users.filter((u) => u.role === 'student'));
      setTeachers(users.filter((u) => u.role === 'teacher'));
    });
    void api.listDevices().then(setDevices);
  }, [refreshLessons]);

  return (
    <div className="card">
      <h2>Lessen plannen</h2>
      {error && <p className="error">{error}</p>}

      <LessonForm
        isAdmin={isAdmin}
        students={students}
        teachers={teachers}
        onCreated={refreshLessons}
      />

      {!lessons && <p className="muted">Laden…</p>}
      {lessons && lessons.length === 0 && <p className="muted">Nog geen lessen gepland.</p>}
      {lessons && lessons.length > 0 && (
        <ul className="lesson-list">
          {lessons.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`lesson-item${selectedId === l.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}
              >
                <span>
                  <strong>{l.title || 'Les'}</strong> — {l.student.name}
                  <div className="muted">
                    {formatWhen(l.startsAt)} · {l.durationMinutes} min · leraar {l.teacher.name}
                  </div>
                </span>
                <span className="tag">{l.status}</span>
              </button>
              {selectedId === l.id && (
                <LessonDetail
                  lessonId={l.id}
                  devices={devices}
                  onDeleted={() => {
                    setSelectedId(null);
                    void refreshLessons();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LessonForm({
  isAdmin,
  students,
  teachers,
  onCreated,
}: {
  isAdmin: boolean;
  students: UserDto[];
  teachers: UserDto[];
  onCreated: () => void;
}) {
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const input = {
      studentId,
      teacherId: isAdmin ? teacherId : undefined,
      title: title || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : '',
      durationMinutes: duration,
    };
    const parsed = CreateLessonSchema.safeParse(input);
    if (!parsed.success || (isAdmin && !teacherId)) {
      setError(
        parsed.success ? 'Kies een leraar' : 'Controleer de gegevens (student, datum/tijd).',
      );
      return;
    }

    setBusy(true);
    try {
      await api.createLesson(parsed.data);
      setTitle('');
      setStartsAt('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Plannen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lesson-form">
      <label htmlFor="lf-student">Student</label>
      <select id="lf-student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
        <option value="">— kies een student —</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {isAdmin && (
        <>
          <label htmlFor="lf-teacher">Leraar</label>
          <select id="lf-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">— kies een leraar —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label htmlFor="lf-title">Titel (optioneel)</label>
      <input id="lf-title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="lf-when">Datum en tijd</label>
      <input
        id="lf-when"
        type="datetime-local"
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
      />

      <label htmlFor="lf-duration">Duur (minuten)</label>
      <input
        id="lf-duration"
        type="number"
        min={5}
        max={600}
        value={duration}
        onChange={(e) => setDuration(Number(e.target.value))}
      />

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Les inplannen'}
      </button>
    </form>
  );
}

function LessonDetail({
  lessonId,
  devices,
  onDeleted,
}: {
  lessonId: string;
  devices: DeviceDto[];
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { online } = usePresence();

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.getLesson(lessonId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, [lessonId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startRecording() {
    setError(null);
    try {
      await api.startRecording(lessonId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opname starten mislukt');
    }
  }

  async function stopRecording() {
    setError(null);
    try {
      await api.stopRecording(lessonId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opname stoppen mislukt');
    }
  }

  async function toggleDevice(deviceId: string, checked: boolean) {
    if (!detail) return;
    const current = new Set(detail.devices.map((d) => d.id));
    if (checked) current.add(deviceId);
    else current.delete(deviceId);
    try {
      setDetail(await api.setLessonDevices(lessonId, [...current]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opslaan mislukt');
    }
  }

  async function removeLesson() {
    if (!window.confirm('Les verwijderen?')) return;
    try {
      await api.deleteLesson(lessonId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Laden…</p>;

  return (
    <div className="lesson-detail">
      <h3>Camera's voor deze les</h3>
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

      <h3>Opname</h3>
      <RecordingControls
        detail={detail}
        onlineSelected={detail.devices.filter((d) => online.has(d.id)).length}
        onStart={startRecording}
        onStop={stopRecording}
        onRefresh={load}
      />

      <h3>Lesmateriaal</h3>
      <MaterialList detail={detail} onChanged={load} />
      <MaterialForm lessonId={lessonId} onAdded={load} />

      <div className="lesson-actions">
        <button type="button" className="linkbtn danger" onClick={removeLesson}>
          Les verwijderen
        </button>
      </div>
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

function RecordingControls({
  detail,
  onlineSelected,
  onStart,
  onStop,
  onRefresh,
}: {
  detail: LessonDetailDto;
  onlineSelected: number;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
}) {
  const isRecording = detail.status === 'recording';
  return (
    <div>
      <p className="muted">
        Status: <strong>{detail.status}</strong> · {onlineSelected} geselecteerde camera(’s) online
      </p>
      {isRecording ? (
        <button type="button" onClick={onStop}>
          Stop opname
        </button>
      ) : (
        <button type="button" onClick={onStart} disabled={onlineSelected === 0}>
          Start opname
        </button>
      )}
      {detail.recordings.length > 0 && (
        <ul className="material-list">
          {detail.recordings.map((r) => (
            <li key={r.id}>
              <div>
                Camera-opname <span className="tag">{r.status}</span>{' '}
                {r.sizeBytes > 0 && <span className="muted">{formatBytes(r.sizeBytes)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isRecording && (
        <button type="button" className="linkbtn" onClick={onRefresh}>
          Vernieuwen
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CreateLessonSchema, type LessonDto, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatWhen } from '../format.js';

export function LessonManagement({ isAdmin }: { isAdmin: boolean }) {
  const [lessons, setLessons] = useState<LessonDto[] | null>(null);
  const [students, setStudents] = useState<UserDto[]>([]);
  const [teachers, setTeachers] = useState<UserDto[]>([]);
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
      // Admins teach too, so they can be chosen as a lesson's teacher.
      setTeachers(users.filter((u) => u.role === 'teacher' || u.role === 'admin'));
    });
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
              <Link to={`/lessons/${l.id}`} className="lesson-item">
                <span>
                  <strong>{l.title || 'Les'}</strong> — {l.student.name}
                  <div className="muted">
                    {formatWhen(l.startsAt)} · {l.durationMinutes} min · leraar {l.teacher.name}
                  </div>
                </span>
                <span className="tag">{l.status}</span>
              </Link>
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
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(12);
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
      repeatWeeks: repeat ? weeks : undefined,
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
                {t.role === 'admin' ? ' (beheerder)' : ''}
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

      <label className="checkbox" style={{ marginTop: '1rem' }}>
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        Wekelijks herhalen
      </label>
      {repeat && (
        <>
          <label htmlFor="lf-weeks">Aantal weken</label>
          <input
            id="lf-weeks"
            type="number"
            min={1}
            max={52}
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          />
          <p className="muted">Vakantieweken worden automatisch overgeslagen.</p>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : repeat ? 'Reeks inplannen' : 'Les inplannen'}
      </button>
    </form>
  );
}

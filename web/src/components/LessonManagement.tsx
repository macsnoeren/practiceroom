import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CreateLessonSchema,
  type LessonDto,
  type HolidayDto,
  type UserDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { addDays, addMonths, isHolidayDay, monthGrid, weekDays, ymd } from '../calendar.js';
import { Modal } from './Modal.js';

type View = 'day' | 'week' | 'month';

const DAY_NAMES = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function DayColumn({
  day,
  holidays,
  lessons,
  onPlan,
}: {
  day: Date;
  holidays: HolidayDto[];
  lessons: LessonDto[];
  onPlan: (dayKey: string) => void;
}) {
  const key = ymd(day);
  const holiday = isHolidayDay(key, holidays);
  return (
    <div className={`cal-col${holiday ? ' holiday' : ''}`}>
      <div className="cal-col-head">
        <span>
          {DAY_NAMES[(day.getDay() + 6) % 7]} {day.getDate()}
        </span>
        {!holiday && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => onPlan(key)}
            aria-label="Plan op deze dag"
          >
            +
          </button>
        )}
      </div>
      {holiday && <div className="muted holiday-label">Vakantie</div>}
      {lessons.map((l) => (
        <Link key={l.id} to={`/lessons/${l.id}`} className="lesson-chip">
          <strong>{timeOf(l.startsAt)}</strong> {l.title || 'Les'}
          <div className="muted">{l.student.name}</div>
        </Link>
      ))}
      {!holiday && lessons.length === 0 && <div className="cal-empty">Geen lessen</div>}
    </div>
  );
}

export function LessonManagement({ isAdmin }: { isAdmin: boolean }) {
  const [lessons, setLessons] = useState<LessonDto[] | null>(null);
  const [holidays, setHolidays] = useState<HolidayDto[]>([]);
  const [students, setStudents] = useState<UserDto[]>([]);
  const [teachers, setTeachers] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [studentId, setStudentId] = useState('');
  const [planDate, setPlanDate] = useState<string | null>(null); // non-null = modal open

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setLessons(await api.listLessons());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api
      .listHolidays()
      .then(setHolidays)
      .catch(() => undefined);
    void api.listUsers().then((users) => {
      setStudents(users.filter((u) => u.role === 'student'));
      setTeachers(users.filter((u) => u.role === 'teacher' || u.role === 'admin'));
    });
  }, [refresh]);

  // Group the (optionally student-filtered) lessons by local day.
  const byDay = useMemo(() => {
    const map = new Map<string, LessonDto[]>();
    for (const l of lessons ?? []) {
      if (studentId && l.student.id !== studentId) continue;
      const key = ymd(new Date(l.startsAt));
      const arr = map.get(key);
      if (arr) arr.push(l);
      else map.set(key, [l]);
    }
    return map;
  }, [lessons, studentId]);

  const days = view === 'day' ? [anchor] : view === 'week' ? weekDays(anchor) : monthGrid(anchor);

  function goPrev() {
    setAnchor(view === 'month' ? addMonths(anchor, -1) : addDays(anchor, view === 'day' ? -1 : -7));
  }
  function goNext() {
    setAnchor(view === 'month' ? addMonths(anchor, 1) : addDays(anchor, view === 'day' ? 1 : 7));
  }

  const periodLabel =
    view === 'day'
      ? anchor.toLocaleDateString('nl-NL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : view === 'week'
        ? `${days[0]!.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${days[6]!.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : anchor.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <button type="button" onClick={() => setPlanDate('')}>
            + Les inplannen
          </button>

          <div className="toolbar-nav">
            <button type="button" className="secondary" onClick={goPrev} aria-label="Vorige">
              ◀
            </button>
            <strong className="period">{periodLabel}</strong>
            <button type="button" className="secondary" onClick={goNext} aria-label="Volgende">
              ▶
            </button>
            <button type="button" className="linkbtn" onClick={() => setAnchor(new Date())}>
              Vandaag
            </button>
          </div>

          <div className="toolbar-right">
            <div className="viewtoggle">
              <button
                type="button"
                className={view === 'day' ? '' : 'secondary'}
                onClick={() => setView('day')}
              >
                Dag
              </button>
              <button
                type="button"
                className={view === 'week' ? '' : 'secondary'}
                onClick={() => setView('week')}
              >
                Week
              </button>
              <button
                type="button"
                className={view === 'month' ? '' : 'secondary'}
                onClick={() => setView('month')}
              >
                Maand
              </button>
            </div>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              aria-label="Filter op student"
            >
              <option value="">Alle studenten</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {view !== 'month' ? (
          <div className={view === 'day' ? 'cal-day' : 'cal-week'}>
            {days.map((day) => (
              <DayColumn
                key={ymd(day)}
                day={day}
                holidays={holidays}
                lessons={byDay.get(ymd(day)) ?? []}
                onPlan={(k) => setPlanDate(`${k}T09:00`)}
              />
            ))}
          </div>
        ) : (
          <div className="cal-month">
            {DAY_NAMES.map((n) => (
              <div key={n} className="cal-weekday">
                {n}
              </div>
            ))}
            {days.map((day) => {
              const key = ymd(day);
              const holiday = isHolidayDay(key, holidays);
              const inMonth = day.getMonth() === anchor.getMonth();
              return (
                <div
                  key={key}
                  className={`cal-cell${inMonth ? '' : ' faded'}${holiday ? ' holiday' : ''}`}
                >
                  <button
                    type="button"
                    className="cal-daynum"
                    onClick={() => setPlanDate(`${key}T09:00`)}
                    title="Plan op deze dag"
                  >
                    {day.getDate()}
                  </button>
                  {(byDay.get(key) ?? []).map((l) => (
                    <Link key={l.id} to={`/lessons/${l.id}`} className="lesson-chip small">
                      {timeOf(l.startsAt)} {l.student.name}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {planDate !== null && (
        <Modal title="Les inplannen" onClose={() => setPlanDate(null)}>
          <LessonForm
            isAdmin={isAdmin}
            students={students}
            teachers={teachers}
            initialDate={planDate || undefined}
            onCreated={() => {
              setPlanDate(null);
              void refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function LessonForm({
  isAdmin,
  students,
  teachers,
  initialDate,
  onCreated,
}: {
  isAdmin: boolean;
  students: UserDto[];
  teachers: UserDto[];
  initialDate?: string;
  onCreated: () => void;
}) {
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(initialDate ?? '');
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
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Plannen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
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

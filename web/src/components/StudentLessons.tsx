import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type HolidayDto, type LessonDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatDateRange, formatWhen } from '../format.js';

type TimelineRow =
  | { kind: 'lesson'; at: number; lesson: LessonDto }
  | { kind: 'holiday'; at: number; holiday: HolidayDto };

/** A student's (or any user's) chronological timeline of lessons and the school
 * holidays in between. Each lesson links to its own dashboard at
 * `${basePath}/:id`; a lesson that falls in a holiday shows as cancelled. */
export function StudentLessons({ basePath }: { basePath: string }) {
  const [lessons, setLessons] = useState<LessonDto[] | null>(null);
  const [holidays, setHolidays] = useState<HolidayDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listMyLessons()
      .then(setLessons)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Laden mislukt'));
    api
      .listHolidays()
      .then(setHolidays)
      .catch(() => undefined);
  }, []);

  // Merge lessons and holidays into one date-ordered timeline so vacations
  // appear between the lessons (even when a recurring lesson was skipped).
  const rows: TimelineRow[] = [
    ...(lessons ?? []).map(
      (lesson): TimelineRow => ({ kind: 'lesson', at: Date.parse(lesson.startsAt), lesson }),
    ),
    ...holidays.map(
      (holiday): TimelineRow => ({ kind: 'holiday', at: Date.parse(holiday.startsOn), holiday }),
    ),
  ].sort((a, b) => a.at - b.at);

  const empty = lessons !== null && lessons.length === 0 && holidays.length === 0;

  return (
    <div className="card">
      <h2>Mijn lessen</h2>
      {error && <p className="error">{error}</p>}
      {!lessons && !error && <p className="muted">Laden…</p>}
      {empty && <p className="muted">Je hebt nog geen geplande lessen.</p>}

      {rows.length > 0 && (
        <ul className="lesson-list">
          {rows.map((row) =>
            row.kind === 'holiday' ? (
              <li key={`h-${row.holiday.id}`}>
                <div className="lesson-item holiday-row">
                  <span>
                    <strong>🏖️ {row.holiday.name}</strong>
                    <div className="muted">
                      Vakantie · {formatDateRange(row.holiday.startsOn, row.holiday.endsOn)}
                    </div>
                  </span>
                  <span className="tag tag-holiday">vakantie</span>
                </div>
              </li>
            ) : row.lesson.holidayName ? (
              // The lesson itself falls in a holiday: shown for clarity, not clickable.
              <li key={row.lesson.id}>
                <div className="lesson-item lapsed">
                  <span>
                    <strong>{row.lesson.title || 'Les'}</strong>
                    <div className="muted">
                      {formatWhen(row.lesson.startsAt)} · {row.lesson.durationMinutes} min · leraar{' '}
                      {row.lesson.teacher.name}
                    </div>
                  </span>
                  <span className="tag tag-holiday">Vervalt · {row.lesson.holidayName}</span>
                </div>
              </li>
            ) : (
              <li key={row.lesson.id}>
                <Link className="lesson-item" to={`${basePath}/${row.lesson.id}`}>
                  <span>
                    <strong>{row.lesson.title || 'Les'}</strong>
                    <div className="muted">
                      {formatWhen(row.lesson.startsAt)} · {row.lesson.durationMinutes} min · leraar{' '}
                      {row.lesson.teacher.name}
                    </div>
                  </span>
                  <span className="tag">{row.lesson.status}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type HolidayDto, type LessonDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatDateRange, formatWhen } from '../format.js';

/** A student's (or any user's) list of lessons they attend. Each lesson links
 * to their own lesson dashboard at `${basePath}/:id`. */
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

  return (
    <>
      <div className="card">
        <h2>Mijn lessen</h2>
        {error && <p className="error">{error}</p>}
        {!lessons && !error && <p className="muted">Laden…</p>}
        {lessons && lessons.length === 0 && (
          <p className="muted">Je hebt nog geen geplande lessen.</p>
        )}
        {lessons && lessons.length > 0 && (
          <ul className="lesson-list">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link className="lesson-item" to={`${basePath}/${l.id}`}>
                  <span>
                    <strong>{l.title || 'Les'}</strong>
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

      <div className="card">
        <h2>Vakanties</h2>
        {holidays.length === 0 && <p className="muted">Geen vakanties ingepland.</p>}
        {holidays.length > 0 && (
          <ul className="material-list">
            {holidays.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{h.name}</strong>
                  <div className="muted">{formatDateRange(h.startsOn, h.endsOn)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

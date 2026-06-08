import { useEffect, useState } from 'react';
import { type LessonDetailDto, type LessonDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatWhen } from '../format.js';
import { LessonPlayer } from './LessonPlayer.js';
import { CompositePlayer } from './CompositePlayer.js';

export function StudentLessons() {
  const [lessons, setLessons] = useState<LessonDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listLessons()
      .then(setLessons)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Laden mislukt'));
  }, []);

  return (
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
              <button
                type="button"
                className={`lesson-item${selectedId === l.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}
              >
                <span>
                  <strong>{l.title || 'Les'}</strong>
                  <div className="muted">
                    {formatWhen(l.startsAt)} · {l.durationMinutes} min · leraar {l.teacher.name}
                  </div>
                </span>
                <span className="tag">{l.status}</span>
              </button>
              {selectedId === l.id && <StudentLessonDetail lessonId={l.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentLessonDetail({ lessonId }: { lessonId: string }) {
  const [detail, setDetail] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLesson(lessonId)
      .then(setDetail)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Laden mislukt'));
  }, [lessonId]);

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Laden…</p>;

  const hasRecording = detail.recordings.some((r) => r.status === 'completed');

  return (
    <div className="lesson-detail">
      <CompositePlayer lessonId={detail.id} composite={detail.composite} />
      <LessonPlayer
        recordings={detail.recordings}
        deviceName={(id) => detail.devices.find((d) => d.id === id)?.name ?? 'Camera'}
      />
      {!hasRecording && !detail.composite && (
        <p className="muted">Na de les verschijnt hier de opname om terug te kijken.</p>
      )}

      <h3>Lesmateriaal</h3>
      {detail.materials.length === 0 && <p className="muted">Nog geen materiaal.</p>}
      {detail.materials.length > 0 && (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

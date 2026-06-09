import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LessonDetailDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatWhen } from '../format.js';
import { CompositePlayer } from './CompositePlayer.js';
import { LessonPlayer } from './LessonPlayer.js';

/** A student's own per-lesson dashboard: watch the recording back, see the
 * material, and keep personal notes/questions about the lesson. */
export function StudentLessonDashboard({ meId, backTo }: { meId: string; backTo: string }) {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<LessonDetailDto | null>(null);
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
  }, [load]);

  if (error && !detail) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Laden…</p>;

  const isStudent = detail.student.id === meId;
  const hasRecording = detail.recordings.some((r) => r.status === 'completed');

  return (
    <div>
      <p>
        <Link to={backTo}>← Terug naar mijn lessen</Link>
      </p>

      <div className="card">
        <div className="row">
          <div>
            <h2>{detail.title || 'Les'}</h2>
            <div className="muted">
              {formatWhen(detail.startsAt)} · {detail.durationMinutes} min · leraar{' '}
              {detail.teacher.name}
              {detail.room ? ` · ${detail.room.name}` : ''}
            </div>
          </div>
          <span className="tag">{detail.status}</span>
        </div>
      </div>

      <div className="card">
        <h2>Terugkijken</h2>
        <CompositePlayer lessonId={detail.id} composite={detail.composite} />
        <LessonPlayer
          recordings={detail.recordings}
          deviceName={(deviceId) => detail.devices.find((d) => d.id === deviceId)?.name ?? 'Camera'}
        />
        {!hasRecording && !detail.composite && (
          <p className="muted">Na de les verschijnt hier de opname om terug te kijken.</p>
        )}
      </div>

      <div className="card">
        <h2>Mijn aantekeningen</h2>
        {isStudent ? (
          <StudentNotesEditor
            lessonId={detail.id}
            initialNotes={detail.studentNotes}
            onSaved={(updated) => setDetail(updated)}
          />
        ) : (
          <p className="muted">
            {detail.studentNotes || 'De student heeft nog geen aantekeningen gemaakt.'}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Lesmateriaal</h2>
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
    </div>
  );
}

function StudentNotesEditor({
  lessonId,
  initialNotes,
  onSaved,
}: {
  lessonId: string;
  initialNotes: string | null;
  onSaved: (updated: LessonDetailDto) => void;
}) {
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setStatus('saving');
    try {
      const updated = await api.updateStudentNotes(lessonId, notes.trim() || null);
      onSaved(updated);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div>
      <p className="muted">
        Noteer hier waar je tegenaan loopt of welke vragen je hebt. Je leraar kan dit zien.
      </p>
      <textarea
        rows={5}
        value={notes}
        placeholder="Bijv. de overgang in maat 12 lukt nog niet…"
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

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { type DeviceDto, type LessonDetailDto, type LessonDto, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { usePresence } from '../usePresence.js';
import { Modal } from './Modal.js';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function Regiekamer({ user }: { user: UserDto }) {
  const navigate = useNavigate();
  const { online, statuses, frames, gains, levels, setGain } = usePresence({ collectFrames: true });

  const [todayLessons, setTodayLessons] = useState<LessonDto[] | null>(null);
  const [allDevices, setAllDevices] = useState<DeviceDto[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonDetail, setActiveLessonDetail] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic intent: deviceId while waiting to confirm start, null while waiting to confirm stop.
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  // Pending context-switch while a recording is active.
  const [confirmSwitch, setConfirmSwitch] = useState<{ lessonId: string | null } | null>(null);
  const [showOwnForm, setShowOwnForm] = useState(false);
  const [ownTitle, setOwnTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const autoAssignedRef = useRef<Set<string>>(new Set());

  const loadDetail = useCallback(async (id: string) => {
    try {
      const detail = await api.getLesson(id);
      setActiveLessonDetail(detail);
      return detail;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
      return null;
    }
  }, []);

  const refreshLessons = useCallback(() => {
    api
      .listLessons()
      .then((lessons) => setTodayLessons(lessons.filter((l) => isToday(l.startsAt))))
      .catch(() => setTodayLessons([]));
  }, []);

  useEffect(() => {
    refreshLessons();
    api.listDevices().then(setAllDevices).catch(() => undefined);
  }, [refreshLessons]);

  // Auto-assign all devices to a newly selected lesson that has no cameras yet.
  useEffect(() => {
    if (!activeLessonId || !activeLessonDetail || allDevices.length === 0) return;
    if (autoAssignedRef.current.has(activeLessonId)) return;
    const finished = activeLessonDetail.status === 'recorded' || activeLessonDetail.status === 'ready';
    if (!finished && activeLessonDetail.devices.length === 0) {
      autoAssignedRef.current.add(activeLessonId);
      api
        .setLessonDevices(activeLessonId, allDevices.map((d) => d.id))
        .then(() => loadDetail(activeLessonId))
        .catch(() => undefined);
    }
  }, [activeLessonId, activeLessonDetail, allDevices, loadDetail]);

  // Which camera is actually recording right now (socket status takes precedence over DB).
  const liveActiveId = useMemo(() => {
    if (!activeLessonDetail) return null;
    const ids = new Set(allDevices.map((d) => d.id));
    const reporting = Object.keys(statuses).find(
      (dev) => ids.has(dev) && statuses[dev] === 'recording',
    );
    if (reporting) return reporting;
    return (
      [...activeLessonDetail.recordings].reverse().find((r) => r.status === 'recording')
        ?.deviceId ?? null
    );
  }, [activeLessonDetail, allDevices, statuses]);

  // Clear the optimistic guess once live state agrees.
  useEffect(() => {
    if (pending !== undefined && liveActiveId === pending) setPending(undefined);
  }, [liveActiveId, pending]);

  const activeId = pending !== undefined ? pending : liveActiveId;
  const isRecording = activeId !== null;

  async function doSelectLesson(lessonId: string) {
    setError(null);
    setActiveLessonId(lessonId);
    setActiveLessonDetail(null);
    setPending(undefined);
    await loadDetail(lessonId);
  }

  async function selectLesson(lessonId: string) {
    if (isRecording && activeLessonId !== lessonId) {
      setConfirmSwitch({ lessonId });
      return;
    }
    await doSelectLesson(lessonId);
  }

  function requestOwnVideo() {
    if (isRecording) {
      // null signals "switch to own-video form after stopping"
      setConfirmSwitch({ lessonId: null });
      return;
    }
    setShowOwnForm(true);
  }

  async function confirmSwitchContext() {
    if (!confirmSwitch || !activeLessonId) return;
    try {
      await api.stopRecording(activeLessonId);
    } catch {
      // ignore stop errors — proceed with context switch regardless
    }
    const target = confirmSwitch.lessonId;
    setConfirmSwitch(null);
    setPending(undefined);
    if (target === null) {
      setShowOwnForm(true);
    } else {
      await doSelectLesson(target);
    }
  }

  async function createOwnLesson(e: FormEvent) {
    e.preventDefault();
    const title = ownTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const lesson = await api.createLesson({
        title,
        studentId: user.id,
        startsAt: new Date().toISOString(),
        durationMinutes: 60,
      });
      setOwnTitle('');
      setShowOwnForm(false);
      refreshLessons();
      await doSelectLesson(lesson.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aanmaken mislukt');
    } finally {
      setCreating(false);
    }
  }

  async function startOn(deviceId: string) {
    if (!activeLessonId || !activeLessonDetail) return;
    setError(null);
    setPending(deviceId);
    try {
      // Ensure the device is linked to this lesson before starting.
      const currentIds = new Set(activeLessonDetail.devices.map((d) => d.id));
      if (!currentIds.has(deviceId)) {
        await api.setLessonDevices(activeLessonId, [...currentIds, deviceId]);
      }
      await api.startRecording(activeLessonId, deviceId);
      await loadDetail(activeLessonId);
    } catch (err) {
      setPending(undefined);
      setError(err instanceof ApiError ? err.message : 'Starten mislukt');
    }
  }

  async function stopActive() {
    if (!activeLessonId) return;
    setError(null);
    setPending(null);
    try {
      await api.stopRecording(activeLessonId);
      await loadDetail(activeLessonId);
    } catch (err) {
      setPending(undefined);
      setError(err instanceof ApiError ? err.message : 'Stoppen mislukt');
    }
  }

  async function finishLesson() {
    if (!activeLessonId) return;
    setError(null);
    try {
      await api.finishRecording(activeLessonId);
      await loadDetail(activeLessonId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Afronden mislukt');
    }
  }

  const finished =
    activeLessonDetail?.status === 'recorded' || activeLessonDetail?.status === 'ready';

  // Own-video lessons: teacher is also the student.
  const isOwnLesson = (l: LessonDto) => l.teacher.id === l.student.id;

  const sortedLessons = (todayLessons ?? [])
    .slice()
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const activeLesson = sortedLessons.find((l) => l.id === activeLessonId) ?? null;

  return (
    <div className="regie-page">
      <div className="page-head">
        <h1>Regiekamer</h1>
        {activeLesson ? (
          <p>
            {isOwnLesson(activeLesson) ? (
              <span className="tag" style={{ marginRight: '0.5rem' }}>
                Eigen video
              </span>
            ) : null}
            {activeLesson.title || 'Les'} &middot; {formatTime(activeLesson.startsAt)} &middot;{' '}
            {isOwnLesson(activeLesson) ? activeLesson.teacher.name : activeLesson.student.name}
            {isRecording && (
              <span className="tag rec" style={{ marginLeft: '0.75rem' }}>
                ● opname loopt
              </span>
            )}
          </p>
        ) : (
          <p className="muted">Kies een les rechts om te beginnen, of maak een eigen video.</p>
        )}
      </div>

      <div className="regie-layout">
        {/* ── LEFT: camera panel ── */}
        <div className="card control-room regie-cameras">
          <div className="row">
            <h2>Camera&rsquo;s</h2>
            {activeLessonId ? (
              activeId ? (
                <span className="tag rec">● REC</span>
              ) : (
                <span className="tag">standby</span>
              )
            ) : (
              <span className="tag">geen les geselecteerd</span>
            )}
          </div>

          {!activeLessonId && (
            <p className="muted">
              Selecteer een les in het paneel rechts (of klik &ldquo;+ Eigen video&rdquo;) om een
              opname te starten.
            </p>
          )}

          {allDevices.length === 0 ? (
            <p className="muted">Geen camera&rsquo;s geregistreerd.</p>
          ) : (
            <div className="cam-grid">
              {allDevices.map((d) => {
                const isOnline = online.has(d.id);
                const isActive = activeId === d.id;
                const frame = frames[d.id];
                const canClick = !!activeLessonId && !finished && (isOnline || isActive);
                const gainPct = Math.round((gains[d.id] ?? 1) * 100);
                return (
                  <div key={d.id} className="cam-cell">
                    <button
                      type="button"
                      className={`cam-tile${isActive ? ' recording' : ''}${isOnline ? '' : ' offline'}`}
                      disabled={!canClick}
                      onClick={() => (isActive ? void stopActive() : void startOn(d.id))}
                      title={
                        !activeLessonId
                          ? 'Selecteer eerst een les'
                          : finished
                            ? 'Les is al afgerond'
                            : undefined
                      }
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
                    {isOnline && (
                      <>
                        <div className="cam-level" title="Geluidsniveau" aria-hidden>
                          <span>🔊</span>
                          <div className="level-track">
                            <div
                              className="level-fill"
                              style={{ width: `${Math.round((levels[d.id] ?? 0) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="cam-volume" title="Microfoonvolume">
                          <span aria-hidden>🎙️</span>
                          <input
                            type="range"
                            min={0}
                            max={200}
                            step={5}
                            value={gainPct}
                            aria-label={`Microfoonvolume ${d.name}`}
                            onChange={(e) => setGain(d.id, Number(e.target.value) / 100)}
                          />
                          <span className="cam-volume-val">{gainPct}%</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeLessonId && !finished && (
            <div className="recording-buttons">
              {activeId && (
                <button type="button" className="secondary" onClick={() => void stopActive()}>
                  Stop opname
                </button>
              )}
              <button
                type="button"
                onClick={() => void finishLesson()}
                disabled={
                  !activeLessonDetail || activeLessonDetail.recordings.length === 0
                }
              >
                Les afronden &amp; video maken
              </button>
              <button
                type="button"
                className="linkbtn"
                onClick={() => activeLessonId && void loadDetail(activeLessonId)}
              >
                Vernieuwen
              </button>
            </div>
          )}

          {activeLessonId && finished && (
            <div className="recording-buttons">
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(`/lessons/${activeLessonId}`)}
              >
                Naar les &amp; video →
              </button>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {activeLessonDetail && activeLessonDetail.recordings.length > 0 && (
            <ul className="material-list" style={{ marginTop: '0.75rem' }}>
              {activeLessonDetail.recordings.slice(-5).map((r, i, arr) => {
                const devName =
                  allDevices.find((d) => d.id === r.deviceId)?.name ?? 'Camera';
                return (
                  <li key={r.id}>
                    <span>
                      Segment {arr.length > 5 ? i + activeLessonDetail.recordings.length - 4 : i + 1}
                      {' · '}
                      {devName} <span className="tag">{r.status}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── RIGHT: today's lessons sidebar ── */}
        <div className="regie-sidebar">
          <div className="card regie-sidebar-card">
            <div className="regie-sidebar-head">
              <h2>Vandaag</h2>
              <button type="button" className="secondary" onClick={requestOwnVideo}>
                + Eigen video
              </button>
            </div>

            {todayLessons === null && <p className="muted">Laden…</p>}
            {todayLessons !== null && sortedLessons.length === 0 && (
              <p className="muted">Geen lessen vandaag gepland.</p>
            )}
            {sortedLessons.length > 0 && (
              <ul className="regie-lesson-list">
                {sortedLessons.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className={`regie-lesson-item${l.id === activeLessonId ? ' active' : ''}`}
                      onClick={() => void selectLesson(l.id)}
                    >
                      <div className="regie-lesson-time">{formatTime(l.startsAt)}</div>
                      <div className="regie-lesson-body">
                        <div className="regie-lesson-name">
                          {isOwnLesson(l) ? (
                            <span className="muted">(eigen) </span>
                          ) : null}
                          {isOwnLesson(l) ? l.title || '—' : l.student.name}
                        </div>
                        {l.title && !isOwnLesson(l) && (
                          <div className="regie-lesson-title">{l.title}</div>
                        )}
                        {l.room && (
                          <div className="regie-lesson-title">{l.room.name}</div>
                        )}
                      </div>
                      <span
                        className={`tag${l.status === 'recording' ? ' rec' : l.status === 'ready' ? ' tag-ok' : ''}`}
                      >
                        {l.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {activeLessonId && (
            <div style={{ marginTop: '0.5rem', textAlign: 'right' }}>
              <button
                type="button"
                className="linkbtn"
                onClick={() => navigate(`/lessons/${activeLessonId}`)}
              >
                Volledig lesdashboard →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirm context-switch while recording */}
      {confirmSwitch !== null && (
        <Modal title="Opname loopt" onClose={() => setConfirmSwitch(null)}>
          <p>Er is een opname bezig. Wil je stoppen en overschakelen?</p>
          <p className="muted">De opname tot nu toe wordt bewaard bij de huidige les.</p>
          <div className="recording-buttons">
            <button type="button" onClick={() => void confirmSwitchContext()}>
              Ja, stop &amp; schakel over
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirmSwitch(null)}
            >
              Annuleren
            </button>
          </div>
        </Modal>
      )}

      {/* Own video: enter a title */}
      {showOwnForm && (
        <Modal title="Eigen video opnemen" onClose={() => { setShowOwnForm(false); setError(null); }}>
          <p className="muted">
            Geef een titel op. Na het afronden kun je de video opslaan in je bibliotheek via het
            lesdashboard.
          </p>
          <form onSubmit={(e) => void createOwnLesson(e)}>
            <label htmlFor="own-title">Titel</label>
            <input
              id="own-title"
              value={ownTitle}
              onChange={(e) => setOwnTitle(e.target.value)}
              placeholder="bijv. Demo stuk, Oefening voor volgende les…"
              autoFocus
            />
            {error && <p className="error">{error}</p>}
            <div className="recording-buttons">
              <button type="submit" disabled={creating || !ownTitle.trim()}>
                {creating ? 'Bezig…' : 'Starten'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => { setShowOwnForm(false); setError(null); }}
              >
                Annuleren
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

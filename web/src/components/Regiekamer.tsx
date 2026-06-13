import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ComposedSourceDto, type DeviceDto, type LessonDetailDto, type LessonDto, type RecordingCompleted, type RoomDto, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes } from '../format.js';
import { usePresence } from '../usePresence.js';
import { CompositePlayer } from './CompositePlayer.js';
import { LessonPlayer } from './LessonPlayer.js';
import { Modal } from './Modal.js';

function SaveToLibraryInline({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setStatus('saving');
    try {
      await api.saveLessonToLibrary(lessonId, { title: title.trim() });
      setStatus('saved');
      setOpen(false);
      setTitle('');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'saved') return <span className="success">Opgeslagen in bibliotheek.</span>;
  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Opslaan in mijn bibliotheek
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void save(e)} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titel voor de bibliotheek"
        style={{ flex: '1 1 200px' }}
        autoFocus
      />
      <button type="submit" disabled={status === 'saving' || !title.trim()}>
        {status === 'saving' ? 'Opslaan…' : 'Opslaan'}
      </button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Annuleren</button>
      {status === 'error' && <span className="error"> Opslaan mislukt.</span>}
    </form>
  );
}

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
  const { online, statuses, frames, gains, levels, setGain } = usePresence({
    collectFrames: true,
    onRecordingCompleted: useCallback(
      ({ lessonId }: RecordingCompleted) => {
        // When a device finishes uploading, refresh the active lesson so the
        // segment size and status update without the teacher needing to reload.
        setActiveLessonId((current) => {
          if (current === lessonId) {
            api.getLesson(lessonId).then(setActiveLessonDetail).catch(() => undefined);
          }
          return current;
        });
      },
      [],
    ),
  });

  const [todayLessons, setTodayLessons] = useState<LessonDto[] | null>(null);
  const [allDevices, setAllDevices] = useState<DeviceDto[]>([]);
  const [sources, setSources] = useState<ComposedSourceDto[]>([]);
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  // The selected room is remembered across reloads.
  const [roomId, setRoomId] = useState<string | null>(
    () => localStorage.getItem('regie.roomId'),
  );
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonDetail, setActiveLessonDetail] = useState<LessonDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic intent: a target key ('dev:<id>' or 'src:<id>') while waiting to
  // confirm start, null while waiting to confirm stop, undefined when settled.
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
    api.listComposedSources().then(setSources).catch(() => undefined);
    api
      .listRooms()
      .then((list) => {
        setRooms(list);
        // Default to the first room when none is remembered (or the saved one is gone).
        setRoomId((current) =>
          current && list.some((r) => r.id === current) ? current : (list[0]?.id ?? null),
        );
      })
      .catch(() => undefined);
  }, [refreshLessons]);

  // Persist the chosen room so it is restored on the next visit.
  useEffect(() => {
    if (roomId) localStorage.setItem('regie.roomId', roomId);
    else localStorage.removeItem('regie.roomId');
  }, [roomId]);

  // Devices belonging to the selected room: cameras (shown as tiles) and the
  // single audio source (whose sound is laid under every video).
  const roomDevices = useMemo(
    () => (roomId ? allDevices.filter((d) => d.roomId === roomId) : allDevices),
    [allDevices, roomId],
  );
  const audioSource = useMemo(
    () => roomDevices.find((d) => d.isAudioSource) ?? null,
    [roomDevices],
  );
  const roomCameras = useMemo(
    () => roomDevices.filter((d) => !d.isAudioSource),
    [roomDevices],
  );

  // Auto-assign the selected room's devices (cameras + audio source) to a newly
  // selected lesson that has no cameras yet.
  useEffect(() => {
    if (!activeLessonId || !activeLessonDetail || roomDevices.length === 0) return;
    if (autoAssignedRef.current.has(activeLessonId)) return;
    const finished = activeLessonDetail.status === 'recorded' || activeLessonDetail.status === 'ready';
    if (!finished && activeLessonDetail.devices.length === 0) {
      autoAssignedRef.current.add(activeLessonId);
      api
        .setLessonDevices(activeLessonId, roomDevices.map((d) => d.id))
        .then(() => loadDetail(activeLessonId))
        .catch(() => undefined);
    }
  }, [activeLessonId, activeLessonDetail, roomDevices, loadDetail]);

  // Which camera is actually recording right now (socket status takes precedence
  // over DB). The audio source also reports 'recording', so it is excluded — we
  // track the active camera tile, not the microphone.
  const liveActiveId = useMemo(() => {
    if (!activeLessonDetail) return null;
    const cameraIds = new Set(allDevices.filter((d) => !d.isAudioSource).map((d) => d.id));
    const reporting = Object.keys(statuses).find(
      (dev) => cameraIds.has(dev) && statuses[dev] === 'recording',
    );
    if (reporting) return reporting;
    return (
      [...activeLessonDetail.recordings]
        .reverse()
        .find((r) => r.status === 'recording' && !r.isAudioTrack)?.deviceId ?? null
    );
  }, [activeLessonDetail, allDevices, statuses]);

  // Composed sources of the selected room, shown as extra tiles next to the
  // cameras.
  const roomSources = useMemo(
    () => (roomId ? sources.filter((s) => s.roomId === roomId) : sources),
    [sources, roomId],
  );

  // The active target as a key: 'src:<id>' when the recording camera is a
  // source's main camera, otherwise 'dev:<deviceId>' for a single camera.
  const liveActiveKey = useMemo(() => {
    if (!liveActiveId) return null;
    const source = roomSources.find((s) =>
      s.members.some((m) => m.role === 'main' && m.deviceId === liveActiveId),
    );
    return source ? `src:${source.id}` : `dev:${liveActiveId}`;
  }, [liveActiveId, roomSources]);

  // Clear the optimistic guess once live state agrees.
  useEffect(() => {
    if (pending !== undefined && liveActiveKey === pending) setPending(undefined);
  }, [liveActiveKey, pending]);

  const activeKey = pending !== undefined ? pending : liveActiveKey;
  const isRecording = activeKey != null;
  const deviceKey = (id: string) => `dev:${id}`;
  const sourceKey = (id: string) => `src:${id}`;

  // Point the lesson at the selected room so the server can find that room's
  // audio source when recording. Returns the (possibly updated) detail.
  async function ensureLessonRoom(detail: LessonDetailDto): Promise<LessonDetailDto> {
    if (!roomId || detail.room?.id === roomId) return detail;
    try {
      await api.updateLesson(detail.id, { roomId });
      const updated = await api.getLesson(detail.id);
      setActiveLessonDetail(updated);
      return updated;
    } catch {
      return detail;
    }
  }

  async function doSelectLesson(lessonId: string) {
    setError(null);
    setActiveLessonId(lessonId);
    setActiveLessonDetail(null);
    setPending(undefined);
    const detail = await loadDetail(lessonId);
    if (detail) await ensureLessonRoom(detail);
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
        teacherId: user.id,
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
    setPending(deviceKey(deviceId));
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

  async function startSource(sourceId: string) {
    if (!activeLessonId) return;
    setError(null);
    setPending(sourceKey(sourceId));
    try {
      // The server links the source's member cameras to the lesson as needed.
      await api.startRecordingSource(activeLessonId, sourceId);
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

  async function removeSegment(recordingId: string) {
    if (!activeLessonId) return;
    if (!window.confirm('Dit segment verwijderen?')) return;
    setError(null);
    try {
      await api.deleteRecording(recordingId);
      await loadDetail(activeLessonId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  async function restartLesson() {
    if (!activeLessonId || !activeLessonDetail) return;
    const msg =
      activeLesson && isOwnLesson(activeLesson)
        ? 'Alle segmenten verwijderen en de eigen video opnieuw beginnen?'
        : 'Alle opnames verwijderen? De les zelf blijft bewaard.';
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      for (const r of activeLessonDetail.recordings) {
        if (r.status !== 'recording') await api.deleteRecording(r.id);
      }
      await loadDetail(activeLessonId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  const finished =
    activeLessonDetail?.status === 'recorded' || activeLessonDetail?.status === 'ready';

  // The camera segments shown to the teacher. The room's audio source records a
  // parallel audio-only segment per camera segment; that is laid under the video
  // by the worker, so it is hidden here rather than listed as its own segment.
  const videoRecordings = activeLessonDetail
    ? activeLessonDetail.recordings.filter((r) => !r.isAudioTrack)
    : [];

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
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {rooms.length > 0 && (
                <select
                  value={roomId ?? ''}
                  onChange={(e) => setRoomId(e.target.value || null)}
                  aria-label="Lokaal"
                >
                  <option value="">Alle lokalen</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              {activeLessonId ? (
                isRecording ? (
                  <span className="tag rec">● REC</span>
                ) : (
                  <span className="tag">standby</span>
                )
              ) : (
                <span className="tag">geen les geselecteerd</span>
              )}
            </div>
          </div>

          {audioSource && (
            <p className="muted" style={{ marginTop: 0 }}>
              🎙 Geluidsbron: <strong>{audioSource.name}</strong>{' '}
              {online.has(audioSource.id) ? (
                <span className="tag tag-ok">● online</span>
              ) : (
                <span className="tag">offline</span>
              )}
              {' '}— dit geluid komt onder elke opname van dit lokaal.
            </p>
          )}

          {!activeLessonId && (
            <p className="muted">
              Selecteer een les in het paneel rechts (of klik &ldquo;+ Eigen video&rdquo;) om een
              opname te starten.
            </p>
          )}

          {roomCameras.length === 0 && roomSources.length === 0 ? (
            <p className="muted">
              {roomId
                ? 'Geen camera’s gekoppeld aan dit lokaal. Koppel ze bij Apparaatbeheer.'
                : 'Geen camera’s geregistreerd.'}
            </p>
          ) : (
            <div className="cam-grid">
              {roomCameras.map((d) => {
                const isOnline = online.has(d.id);
                const isActive = activeKey === deviceKey(d.id);
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

              {/* Composed-source tiles: the main camera big with insets in the
                  corners (the picture-in-picture is rendered in the final video). */}
              {roomSources.map((s) => {
                const main = s.members.find((m) => m.role === 'main');
                const pips = s.members.filter((m) => m.role === 'pip');
                const mainOnline = !!main && online.has(main.deviceId);
                const isActive = activeKey === sourceKey(s.id);
                const frame = main ? frames[main.deviceId] : undefined;
                const canClick = !!activeLessonId && !finished && (mainOnline || isActive);
                const camName = (id: string) =>
                  allDevices.find((dev) => dev.id === id)?.name ?? 'Camera';
                return (
                  <div key={s.id} className="cam-cell">
                    <button
                      type="button"
                      className={`cam-tile${isActive ? ' recording' : ''}${mainOnline ? '' : ' offline'}`}
                      disabled={!canClick}
                      onClick={() => (isActive ? void stopActive() : void startSource(s.id))}
                      title={
                        !activeLessonId
                          ? 'Selecteer eerst een les'
                          : finished
                            ? 'Les is al afgerond'
                            : 'Samengestelde bron'
                      }
                    >
                      {frame ? (
                        <img className="cam-tile-img" src={frame} alt={`Beeld van ${s.name}`} />
                      ) : (
                        <div className="cam-tile-img placeholder">
                          {mainOnline ? 'Wachten op beeld…' : 'Hoofdcamera offline'}
                        </div>
                      )}
                      <div className="cam-tile-bar">
                        <span className="cam-tile-name">🎬 {s.name}</span>
                        {isActive ? (
                          <span className="tag rec">● REC</span>
                        ) : mainOnline ? (
                          <span className="tag tag-ok">● klaar</span>
                        ) : (
                          <span className="tag">offline</span>
                        )}
                      </div>
                    </button>
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                      {pips.length === 0
                        ? 'Alleen hoofdcamera'
                        : pips
                            .map((p) => `+ ${camName(p.deviceId)}`)
                            .join(', ')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeLessonId && !finished && (
            <div className="recording-buttons">
              {isRecording && (
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

      {/* ── Lesson detail: segments, playback, composite ── */}
      {activeLessonId && activeLessonDetail && (
        <>
          {/* Segment list */}
          {videoRecordings.length > 0 && (
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <div className="row">
                <h2>Segmenten</h2>
                {!isRecording && videoRecordings.some((r) => r.status !== 'recording') && (
                  <button type="button" className="linkbtn danger" onClick={() => void restartLesson()}>
                    Opnieuw beginnen
                  </button>
                )}
              </div>
              <ul className="material-list">
                {videoRecordings.map((r, i) => {
                  const devName = allDevices.find((d) => d.id === r.deviceId)?.name ?? 'Camera';
                  return (
                    <li key={r.id}>
                      <span>
                        Segment {i + 1} &middot; {devName}{' '}
                        <span className="tag">{r.status}</span>
                        {!r.hasVideo && <span className="tag">alleen geluid</span>}
                        {r.hasVideo && !r.hasAudio && <span className="tag">zonder geluid</span>}
                        {r.sizeBytes > 0 && (
                          <span className="muted" style={{ marginLeft: '0.35rem' }}>
                            {formatBytes(r.sizeBytes)}
                          </span>
                        )}
                      </span>
                      {r.status !== 'recording' && (
                        <button
                          type="button"
                          className="linkbtn danger"
                          onClick={() => void removeSegment(r.id)}
                        >
                          Verwijderen
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Segment + composite playback */}
          {(activeLessonDetail.composite !== null ||
            videoRecordings.some((r) => r.status === 'completed')) && (
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <CompositePlayer
                lessonId={activeLessonId}
                composite={activeLessonDetail.composite}
              />
              <LessonPlayer
                recordings={videoRecordings}
                deviceName={(deviceId) =>
                  allDevices.find((d) => d.id === deviceId)?.name ?? 'Camera'
                }
              />
              {activeLessonDetail.composite?.status === 'completed' && (
                <div className="recording-buttons" style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <SaveToLibraryInline lessonId={activeLessonId} />
                  <button
                    type="button"
                    className="linkbtn danger"
                    onClick={() => void restartLesson()}
                  >
                    Video verwerpen &amp; opnieuw beginnen
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

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
            Geef een titel op. Na het afronden kun je de video opslaan in je bibliotheek.
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

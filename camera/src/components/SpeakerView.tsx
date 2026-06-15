import { useCallback, useEffect, useRef, useState } from 'react';
import { SYNC_TONE_FADE_MS, type SyncTonePayload } from '@practiceroom/shared';
import { useDeviceSocket } from '../useDeviceSocket.js';

/**
 * A paired speaker device. It stays connected and, on a `sync:tone` command from
 * the server, plays a tone through this machine's speakers — the audible "we're
 * starting" signal that every microphone in the room records so the worker can
 * align the cameras. Browsers only allow audio after a user gesture, so the page
 * must be "activated" once before it can play.
 */
export function SpeakerView({
  device,
  onUnpair,
}: {
  device: { id: string; name: string };
  onUnpair: () => void;
}) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [activated, setActivated] = useState(false);
  const [playingUntil, setPlayingUntil] = useState(0);
  const [lastPlayed, setLastPlayed] = useState<Date | null>(null);

  const playTone = useCallback((tone: SyncTonePayload) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return; // not activated yet — cannot play without a user gesture
    void ctx.resume();
    const now = ctx.currentTime;
    const dur = tone.durationMs / 1000;
    const fade = SYNC_TONE_FADE_MS / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.frequency;
    // A gentle fade in/out avoids clicks (which would smear the onset).
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + fade);
    gain.gain.setValueAtTime(0.9, now + Math.max(fade, dur - fade));
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
    setLastPlayed(new Date());
    setPlayingUntil(Date.now() + dur * 1000);
  }, []);

  const { connected } = useDeviceSocket({ onSyncTone: playTone });

  // Drive the "playing" indicator off the scheduled end time.
  const [, force] = useState(0);
  useEffect(() => {
    if (playingUntil <= Date.now()) return;
    const t = setTimeout(() => force((n) => n + 1), playingUntil - Date.now());
    return () => clearTimeout(t);
  }, [playingUntil]);
  const isPlaying = playingUntil > Date.now();

  function activate() {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    void audioCtxRef.current.resume();
    setActivated(true);
  }

  return (
    <>
      <div className="card row">
        <div>
          Gekoppeld als <strong>{device.name}</strong> <span className="tag">speaker</span>
          <div className="muted">{connected ? '● verbonden met server' : '○ niet verbonden'}</div>
        </div>
        <button type="button" className="secondary" onClick={onUnpair}>
          Ontkoppelen
        </button>
      </div>

      {!activated ? (
        <div className="card">
          <p>
            Zet deze speaker aan. Daarna speelt dit apparaat automatisch het starttoontje af
            wanneer een opname met meerdere camera&rsquo;s begint.
          </p>
          <button type="button" onClick={activate}>
            🔊 Speaker activeren
          </button>
          <p className="muted">
            Eenmalig nodig: browsers staan geluid pas toe na een klik. Laat deze pagina daarna open
            staan met het volume aan.
          </p>
        </div>
      ) : isPlaying ? (
        <div className="card recording">▶ Startsignaal speelt…</div>
      ) : (
        <div className="card">
          <p>✓ Speaker actief — wacht op startsignaal.</p>
          {lastPlayed && (
            <p className="muted">Laatste toon: {lastPlayed.toLocaleTimeString()}</p>
          )}
        </div>
      )}
    </>
  );
}

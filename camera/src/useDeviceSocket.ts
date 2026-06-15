import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  MicGainCommandSchema,
  SOCKET_EVENTS,
  StartRecordingMsgSchema,
  StopRecordingMsgSchema,
  SyncTonePayloadSchema,
  type SyncTonePayload,
} from '@practiceroom/shared';
import { getToken } from './api.js';

export interface ActiveRecording {
  recordingId: string;
  lessonId: string;
}

/**
 * Connects this camera to the realtime channel using its device token and
 * tracks the active recording command from staff. Reports its state back so
 * the dashboard can show it, and exposes `sendFrame` to publish preview
 * snapshots. `onSyncTone` fires when a speaker device is told to play the tone.
 */
export function useDeviceSocket({
  onSyncTone,
}: { onSyncTone?: (tone: SyncTonePayload) => void } = {}) {
  const [connected, setConnected] = useState(false);
  const [activeRecording, setActiveRecording] = useState<ActiveRecording | null>(null);
  const [gainCommand, setGainCommand] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Mirrors activeRecording so the (re)connect handler can report the true state
  // without a stale closure. Reporting 'idle' while a recording is active would
  // let the server treat the live recording as orphaned and reject its chunks.
  const activeRecordingRef = useRef<ActiveRecording | null>(null);
  // Whether this camera is ACTUALLY capturing frames now (set by the recorder via
  // reportCapturing). Drives the 'recording' status report so the server only
  // counts the camera as ready once real capture has started.
  const capturingRef = useRef(false);
  // Stable ref so the socket handler always calls the latest callback.
  const onSyncToneRef = useRef(onSyncTone);
  useEffect(() => {
    onSyncToneRef.current = onSyncTone;
  });

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io({ auth: { deviceToken: token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Report the true state on (re)connect: 'recording' only when actually
      // capturing, so a reconnect mid-recording is not mistaken for idle.
      socket.emit(SOCKET_EVENTS.statusUpdate, {
        state: capturingRef.current ? 'recording' : 'idle',
      });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(SOCKET_EVENTS.recordingStart, (raw: unknown) => {
      const parsed = StartRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      // Arm the recorder; the 'recording' status is reported later, once capture
      // actually begins (via reportCapturing from the recorder).
      activeRecordingRef.current = parsed.data;
      setActiveRecording(parsed.data);
    });
    socket.on(SOCKET_EVENTS.recordingStop, (raw: unknown) => {
      const parsed = StopRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      activeRecordingRef.current = null;
      capturingRef.current = false;
      setActiveRecording(null);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });

    socket.on(SOCKET_EVENTS.micSetGain, (raw: unknown) => {
      const parsed = MicGainCommandSchema.safeParse(raw);
      if (parsed.success) setGainCommand(parsed.data.gain);
    });

    socket.on(SOCKET_EVENTS.syncTone, (raw: unknown) => {
      const parsed = SyncTonePayloadSchema.safeParse(raw);
      if (parsed.success) onSyncToneRef.current?.(parsed.data);
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, []);

  // The recorder calls this when capture actually starts/stops, so the device
  // only reports 'recording' once it is truly capturing frames.
  const reportCapturing = useCallback((active: boolean) => {
    if (capturingRef.current === active) return;
    capturingRef.current = active;
    socketRef.current?.emit(SOCKET_EVENTS.statusUpdate, {
      state: active ? 'recording' : 'idle',
    });
  }, []);

  const sendFrame = useCallback((dataUrl: string) => {
    socketRef.current?.emit(SOCKET_EVENTS.cameraFrame, { dataUrl });
  }, []);

  /** Report the camera's current mic gain back to the control room. */
  const reportGain = useCallback((gain: number) => {
    socketRef.current?.emit(SOCKET_EVENTS.micGain, { gain });
  }, []);

  /** Report the camera's live mic level for the control room's meter. */
  const reportLevel = useCallback((level: number) => {
    socketRef.current?.emit(SOCKET_EVENTS.micLevel, { level });
  }, []);

  return {
    connected,
    activeRecording,
    sendFrame,
    gainCommand,
    reportGain,
    reportLevel,
    reportCapturing,
  };
}

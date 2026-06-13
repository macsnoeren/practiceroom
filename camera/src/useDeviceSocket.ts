import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  MicGainCommandSchema,
  SOCKET_EVENTS,
  StartRecordingMsgSchema,
  StopRecordingMsgSchema,
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
 * snapshots.
 */
export function useDeviceSocket() {
  const [connected, setConnected] = useState(false);
  const [activeRecording, setActiveRecording] = useState<ActiveRecording | null>(null);
  const [gainCommand, setGainCommand] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Mirrors activeRecording so the (re)connect handler can report the true state
  // without a stale closure. Reporting 'idle' while a recording is active would
  // let the server treat the live recording as orphaned and reject its chunks.
  const activeRecordingRef = useRef<ActiveRecording | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io({ auth: { deviceToken: token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(SOCKET_EVENTS.statusUpdate, {
        state: activeRecordingRef.current ? 'recording' : 'idle',
      });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(SOCKET_EVENTS.recordingStart, (raw: unknown) => {
      const parsed = StartRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      activeRecordingRef.current = parsed.data;
      setActiveRecording(parsed.data);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'recording' });
    });
    socket.on(SOCKET_EVENTS.recordingStop, (raw: unknown) => {
      const parsed = StopRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      activeRecordingRef.current = null;
      setActiveRecording(null);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });

    socket.on(SOCKET_EVENTS.micSetGain, (raw: unknown) => {
      const parsed = MicGainCommandSchema.safeParse(raw);
      if (parsed.success) setGainCommand(parsed.data.gain);
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
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

  return { connected, activeRecording, sendFrame, gainCommand, reportGain, reportLevel };
}

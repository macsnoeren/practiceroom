import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
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
 * the dashboard can show it.
 */
export function useDeviceSocket() {
  const [connected, setConnected] = useState(false);
  const [activeRecording, setActiveRecording] = useState<ActiveRecording | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io({ auth: { deviceToken: token } });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(SOCKET_EVENTS.recordingStart, (raw: unknown) => {
      const parsed = StartRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      setActiveRecording(parsed.data);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'recording' });
    });
    socket.on(SOCKET_EVENTS.recordingStop, (raw: unknown) => {
      const parsed = StopRecordingMsgSchema.safeParse(raw);
      if (!parsed.success) return;
      setActiveRecording(null);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });

    return () => {
      socket.close();
    };
  }, []);

  return { connected, activeRecording };
}

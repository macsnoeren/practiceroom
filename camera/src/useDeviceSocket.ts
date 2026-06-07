import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@practiceroom/shared';
import { getToken } from './api.js';

/**
 * Connects this camera to the realtime channel using its device token and
 * reacts to start/stop commands from staff. Actual recording arrives in a
 * later phase; for now we reflect the requested state and report it back.
 */
export function useDeviceSocket() {
  const [connected, setConnected] = useState(false);
  const [recordingRequested, setRecordingRequested] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io({ auth: { deviceToken: token } });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(SOCKET_EVENTS.recordingStart, () => {
      setRecordingRequested(true);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'recording' });
    });
    socket.on(SOCKET_EVENTS.recordingStop, () => {
      setRecordingRequested(false);
      socket.emit(SOCKET_EVENTS.statusUpdate, { state: 'idle' });
    });

    return () => {
      socket.close();
    };
  }, []);

  return { connected, recordingRequested };
}

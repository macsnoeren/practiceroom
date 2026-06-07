import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DeviceOfflineSchema,
  DeviceStatusUpdateSchema,
  OnlineDeviceSchema,
  PresenceSnapshotSchema,
  SOCKET_EVENTS,
  type DeviceState,
} from '@practiceroom/shared';

/**
 * Connects to the realtime channel as staff (session cookie) and tracks which
 * devices are online plus their last reported state. Also exposes commands to
 * start/stop recording on chosen devices.
 */
export function usePresence() {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, DeviceState>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on(SOCKET_EVENTS.presenceSnapshot, (raw: unknown) => {
      const parsed = PresenceSnapshotSchema.safeParse(raw);
      if (parsed.success) setOnline(new Set(parsed.data.devices.map((d) => d.deviceId)));
    });
    socket.on(SOCKET_EVENTS.deviceOnline, (raw: unknown) => {
      const parsed = OnlineDeviceSchema.safeParse(raw);
      if (parsed.success) setOnline((prev) => new Set(prev).add(parsed.data.deviceId));
    });
    socket.on(SOCKET_EVENTS.deviceOffline, (raw: unknown) => {
      const parsed = DeviceOfflineSchema.safeParse(raw);
      if (!parsed.success) return;
      setOnline((prev) => {
        const next = new Set(prev);
        next.delete(parsed.data.deviceId);
        return next;
      });
    });
    socket.on(SOCKET_EVENTS.deviceStatus, (raw: unknown) => {
      const parsed = DeviceStatusUpdateSchema.safeParse(raw);
      if (parsed.success) {
        setStatuses((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.state }));
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  function startRecording(deviceIds: string[]) {
    socketRef.current?.emit(SOCKET_EVENTS.recordingStart, { deviceIds });
  }
  function stopRecording(deviceIds: string[]) {
    socketRef.current?.emit(SOCKET_EVENTS.recordingStop, { deviceIds });
  }

  return { online, statuses, startRecording, stopRecording };
}

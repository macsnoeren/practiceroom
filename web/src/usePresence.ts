import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
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
 * devices are online plus their last reported state.
 */
export function usePresence() {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, DeviceState>>({});

  useEffect(() => {
    const socket = io({ withCredentials: true });

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
    };
  }, []);

  return { online, statuses };
}

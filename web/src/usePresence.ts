import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  CameraFrameSchema,
  DeviceOfflineSchema,
  DeviceStatusUpdateSchema,
  OnlineDeviceSchema,
  PresenceSnapshotSchema,
  SOCKET_EVENTS,
  type DeviceState,
} from '@practiceroom/shared';

/**
 * Connects to the realtime channel as staff (session cookie) and tracks which
 * devices are online plus their last reported state. Pass `collectFrames` to
 * also gather the latest preview snapshot per device (only enable where the
 * control room shows them, to avoid needless re-renders elsewhere).
 */
export function usePresence({ collectFrames = false }: { collectFrames?: boolean } = {}) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, DeviceState>>({});
  const [frames, setFrames] = useState<Record<string, string>>({});

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
      setFrames((prev) => {
        if (!(parsed.data.deviceId in prev)) return prev;
        const next = { ...prev };
        delete next[parsed.data.deviceId];
        return next;
      });
    });
    socket.on(SOCKET_EVENTS.deviceStatus, (raw: unknown) => {
      const parsed = DeviceStatusUpdateSchema.safeParse(raw);
      if (parsed.success) {
        setStatuses((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.state }));
      }
    });
    if (collectFrames) {
      socket.on(SOCKET_EVENTS.cameraFrame, (raw: unknown) => {
        const parsed = CameraFrameSchema.safeParse(raw);
        if (parsed.success) {
          setFrames((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.dataUrl }));
        }
      });
    }

    return () => {
      socket.close();
    };
  }, [collectFrames]);

  return { online, statuses, frames };
}

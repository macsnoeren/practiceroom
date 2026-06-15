import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  CameraFrameSchema,
  DeviceOfflineSchema,
  DeviceStatusUpdateSchema,
  MicGainSchema,
  MicLevelSchema,
  OnlineDeviceSchema,
  PresenceSnapshotSchema,
  RecordingCompletedSchema,
  SOCKET_EVENTS,
  SyncToneStatusSchema,
  type DeviceState,
  type RecordingCompleted,
  type SyncToneStatus,
} from '@practiceroom/shared';

/**
 * Connects to the realtime channel as staff (session cookie) and tracks which
 * devices are online plus their last reported state. Pass `collectFrames` to
 * also gather the latest preview snapshot per device (only enable where the
 * control room shows them, to avoid needless re-renders elsewhere).
 */
export function usePresence({
  collectFrames = false,
  onRecordingCompleted,
}: {
  collectFrames?: boolean;
  onRecordingCompleted?: (data: RecordingCompleted) => void;
} = {}) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, DeviceState>>({});
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [gains, setGains] = useState<Record<string, number>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
  // The lesson whose start tone is pending/playing, so the UI can ask the
  // operator to wait for it. Auto-clears after the tone is done.
  const [syncTone, setSyncTone] = useState<SyncToneStatus | null>(null);
  const syncToneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null);
  // Stable ref so the socket handler always calls the latest callback version
  // without needing to re-register the listener.
  const onRecordingCompletedRef = useRef(onRecordingCompleted);
  useEffect(() => { onRecordingCompletedRef.current = onRecordingCompleted; });

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
    socket.on(SOCKET_EVENTS.syncToneStatus, (raw: unknown) => {
      const parsed = SyncToneStatusSchema.safeParse(raw);
      if (!parsed.success) return;
      setSyncTone(parsed.data);
      clearTimeout(syncToneTimer.current);
      // Clear after the tone finishes (playing), or a safety window (armed).
      const ttl =
        parsed.data.phase === 'playing' ? (parsed.data.durationMs ?? 2000) + 500 : 12000;
      syncToneTimer.current = setTimeout(() => setSyncTone(null), ttl);
    });

    socket.on(SOCKET_EVENTS.recordingCompleted, (raw: unknown) => {
      const parsed = RecordingCompletedSchema.safeParse(raw);
      if (parsed.success) onRecordingCompletedRef.current?.(parsed.data);
    });

    if (collectFrames) {
      socket.on(SOCKET_EVENTS.cameraFrame, (raw: unknown) => {
        const parsed = CameraFrameSchema.safeParse(raw);
        if (parsed.success) {
          setFrames((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.dataUrl }));
        }
      });
      socket.on(SOCKET_EVENTS.micGain, (raw: unknown) => {
        const parsed = MicGainSchema.safeParse(raw);
        if (parsed.success) {
          setGains((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.gain }));
        }
      });
      socket.on(SOCKET_EVENTS.micLevel, (raw: unknown) => {
        const parsed = MicLevelSchema.safeParse(raw);
        if (parsed.success) {
          setLevels((prev) => ({ ...prev, [parsed.data.deviceId]: parsed.data.level }));
        }
      });
    }

    return () => {
      socketRef.current = null;
      clearTimeout(syncToneTimer.current);
      socket.close();
    };
  }, [collectFrames]);

  /** Set a camera's microphone gain (a 0–2 multiplier). */
  const setGain = useCallback((deviceId: string, gain: number) => {
    socketRef.current?.emit(SOCKET_EVENTS.micSetGain, { deviceId, gain });
  }, []);

  return { online, statuses, frames, gains, levels, setGain, syncTone };
}

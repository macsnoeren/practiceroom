import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  CameraFrameInputSchema,
  DeviceStatusSchema,
  MicGainCommandSchema,
  MicLevelInputSchema,
  MicSetGainSchema,
  SOCKET_EVENTS,
  type OnlineDevice,
  type Role,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { corsOrigins } from '../env.js';
import { getSessionContext, SESSION_COOKIE } from '../auth/session.js';
import { hashToken } from '../lib/device.js';

/** Lets HTTP routes ask which devices are currently connected. */
export interface Presence {
  isOnline(deviceId: string): boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
    presence: Presence;
  }
}

/** Who is behind a socket, decided once at the authenticated handshake. */
type SocketData =
  | { kind: 'user'; userId: string; schoolId: string; role: Role }
  | { kind: 'device'; deviceId: string; schoolId: string; name: string };

const schoolRoom = (schoolId: string) => `school:${schoolId}`;
const deviceRoom = (deviceId: string) => `device:${deviceId}`;

function readSessionId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

/**
 * Attaches Socket.IO to the Fastify HTTP server and decorates `app.io` and
 * `app.presence`. Cameras authenticate with their bearer token; staff with the
 * session cookie. Everyone joins their school room, so presence and commands
 * never cross school boundaries.
 */
export function setupRealtime(app: FastifyInstance): void {
  const io = new Server(app.server, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // Online devices per school: schoolId -> deviceId -> { name, socket ids }.
  const online = new Map<string, Map<string, { name: string; sockets: Set<string> }>>();
  const onlineDeviceIds = new Set<string>();

  function markOnline(schoolId: string, deviceId: string, name: string, socketId: string): boolean {
    let school = online.get(schoolId);
    if (!school) {
      school = new Map();
      online.set(schoolId, school);
    }
    let info = school.get(deviceId);
    if (!info) {
      info = { name, sockets: new Set() };
      school.set(deviceId, info);
    }
    const becameOnline = info.sockets.size === 0;
    info.sockets.add(socketId);
    if (becameOnline) onlineDeviceIds.add(deviceId);
    return becameOnline;
  }

  function markOffline(schoolId: string, deviceId: string, socketId: string): boolean {
    const school = online.get(schoolId);
    const info = school?.get(deviceId);
    if (!school || !info) return false;
    info.sockets.delete(socketId);
    if (info.sockets.size === 0) {
      school.delete(deviceId);
      onlineDeviceIds.delete(deviceId);
      return true;
    }
    return false;
  }

  function snapshot(schoolId: string): OnlineDevice[] {
    const school = online.get(schoolId);
    if (!school) return [];
    return [...school.entries()].map(([deviceId, info]) => ({ deviceId, name: info.name }));
  }

  io.use(async (socket, next) => {
    try {
      const deviceToken = socket.handshake.auth?.deviceToken as unknown;
      if (typeof deviceToken === 'string' && deviceToken.length > 0) {
        const device = await prisma.device.findUnique({
          where: { tokenHash: hashToken(deviceToken) },
        });
        if (!device) return next(new Error('unauthorized'));
        socket.data = {
          kind: 'device',
          deviceId: device.id,
          schoolId: device.schoolId,
          name: device.name,
        } satisfies SocketData;
        return next();
      }

      const sessionId = readSessionId(socket.handshake.headers.cookie);
      if (sessionId) {
        const ctx = await getSessionContext(sessionId);
        if (ctx) {
          const { user, activeSchoolId } = ctx;
          // A superadmin's school context is the school they have entered; a
          // normal user's is their own. No school context = no realtime access.
          const schoolId = user.role === 'superadmin' ? activeSchoolId : user.schoolId;
          if (schoolId) {
            socket.data = {
              kind: 'user',
              userId: user.id,
              schoolId,
              role: (user.role === 'superadmin' ? 'admin' : user.role) as Role,
            } satisfies SocketData;
            return next();
          }
        }
      }
      next(new Error('unauthorized'));
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    void socket.join(schoolRoom(data.schoolId));

    if (data.kind === 'device') {
      handleDeviceConnection(socket, data);
    } else {
      // Staff: send the current presence list once.
      socket.emit(SOCKET_EVENTS.presenceSnapshot, { devices: snapshot(data.schoolId) });

      // Staff sets a camera's mic gain -> relay to that device (same school only).
      socket.on(SOCKET_EVENTS.micSetGain, (raw: unknown) => {
        const parsed = MicSetGainSchema.safeParse(raw);
        if (!parsed.success) return;
        if (!onlineDeviceIds.has(parsed.data.deviceId)) return;
        prisma.device
          .findUnique({ where: { id: parsed.data.deviceId }, select: { schoolId: true } })
          .then((device) => {
            if (device?.schoolId !== data.schoolId) return;
            io.to(deviceRoom(parsed.data.deviceId)).emit(SOCKET_EVENTS.micSetGain, {
              gain: parsed.data.gain,
            });
          })
          .catch(() => undefined);
      });
    }
  });

  function handleDeviceConnection(
    socket: Socket,
    data: Extract<SocketData, { kind: 'device' }>,
  ): void {
    void socket.join(deviceRoom(data.deviceId));
    const becameOnline = markOnline(data.schoolId, data.deviceId, data.name, socket.id);
    prisma.device
      .update({ where: { id: data.deviceId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    if (becameOnline) {
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.deviceOnline, {
        deviceId: data.deviceId,
        name: data.name,
      });
    }

    socket.on(SOCKET_EVENTS.statusUpdate, (raw: unknown) => {
      const parsed = DeviceStatusSchema.safeParse(raw);
      if (!parsed.success) return;
      // When a device reports idle, it is not actively recording. Any segments
      // still in 'recording' status in the DB are orphaned (crash / missed stop
      // event) and will never be completed on their own — mark them failed so
      // they can be deleted and don't block the lesson dashboard.
      if (parsed.data.state === 'idle') {
        prisma.recording
          .updateMany({
            where: { deviceId: data.deviceId, status: 'recording' },
            data: { status: 'failed', completedAt: new Date() },
          })
          .catch(() => undefined);
      }
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.deviceStatus, {
        deviceId: data.deviceId,
        state: parsed.data.state,
        message: parsed.data.message,
      });
    });

    // Relay a preview snapshot to the school's staff (never stored).
    socket.on(SOCKET_EVENTS.cameraFrame, (raw: unknown) => {
      const parsed = CameraFrameInputSchema.safeParse(raw);
      if (!parsed.success) return;
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.cameraFrame, {
        deviceId: data.deviceId,
        dataUrl: parsed.data.dataUrl,
      });
    });

    // A camera reports its current mic gain -> tell the school's staff.
    socket.on(SOCKET_EVENTS.micGain, (raw: unknown) => {
      const parsed = MicGainCommandSchema.safeParse(raw);
      if (!parsed.success) return;
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.micGain, {
        deviceId: data.deviceId,
        gain: parsed.data.gain,
      });
    });

    // A camera reports its live mic level -> the control room's meter.
    socket.on(SOCKET_EVENTS.micLevel, (raw: unknown) => {
      const parsed = MicLevelInputSchema.safeParse(raw);
      if (!parsed.success) return;
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.micLevel, {
        deviceId: data.deviceId,
        level: parsed.data.level,
      });
    });

    socket.on('disconnect', () => {
      const becameOffline = markOffline(data.schoolId, data.deviceId, socket.id);
      if (becameOffline) {
        io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.deviceOffline, {
          deviceId: data.deviceId,
        });
      }
    });
  }

  app.addHook('onClose', (_instance, done) => {
    io.close();
    done();
  });

  app.decorate('io', io);
  app.decorate('presence', { isOnline: (deviceId: string) => onlineDeviceIds.has(deviceId) });
}

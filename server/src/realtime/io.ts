import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  DeviceStatusSchema,
  RecordingCommandSchema,
  SOCKET_EVENTS,
  type OnlineDevice,
  type Role,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { corsOrigins } from '../env.js';
import { getSessionUser, SESSION_COOKIE } from '../auth/session.js';
import { hashToken } from '../lib/device.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
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
 * Attaches Socket.IO to the Fastify HTTP server. Cameras authenticate with
 * their bearer token (handshake `auth.deviceToken`); staff authenticate with
 * the session cookie. Everyone joins their school room, so presence and
 * commands never cross school boundaries.
 */
export function setupRealtime(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // Online devices per school: schoolId -> deviceId -> { name, socket ids }.
  const online = new Map<string, Map<string, { name: string; sockets: Set<string> }>>();

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
    return becameOnline;
  }

  function markOffline(schoolId: string, deviceId: string, socketId: string): boolean {
    const school = online.get(schoolId);
    const info = school?.get(deviceId);
    if (!school || !info) return false;
    info.sockets.delete(socketId);
    if (info.sockets.size === 0) {
      school.delete(deviceId);
      return true;
    }
    return false;
  }

  function snapshot(schoolId: string): OnlineDevice[] {
    const school = online.get(schoolId);
    if (!school) return [];
    return [...school.entries()].map(([deviceId, info]) => ({ deviceId, name: info.name }));
  }

  // Authenticate every connection at the handshake; reject anonymous ones.
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
        const user = await getSessionUser(sessionId);
        if (user) {
          socket.data = {
            kind: 'user',
            userId: user.id,
            schoolId: user.schoolId,
            role: user.role as Role,
          } satisfies SocketData;
          return next();
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
      handleStaffConnection(socket, data);
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

    // A device reports its own state; relay it (tagged) to staff.
    socket.on(SOCKET_EVENTS.statusUpdate, (raw: unknown) => {
      const parsed = DeviceStatusSchema.safeParse(raw);
      if (!parsed.success) return;
      io.to(schoolRoom(data.schoolId)).emit(SOCKET_EVENTS.deviceStatus, {
        deviceId: data.deviceId,
        state: parsed.data.state,
        message: parsed.data.message,
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

  function handleStaffConnection(
    socket: Socket,
    data: Extract<SocketData, { kind: 'user' }>,
  ): void {
    socket.emit(SOCKET_EVENTS.presenceSnapshot, { devices: snapshot(data.schoolId) });

    socket.on(SOCKET_EVENTS.recordingStart, (raw: unknown) => {
      void relayCommand(SOCKET_EVENTS.recordingStart, raw, data.schoolId);
    });
    socket.on(SOCKET_EVENTS.recordingStop, (raw: unknown) => {
      void relayCommand(SOCKET_EVENTS.recordingStop, raw, data.schoolId);
    });
  }

  // Forward a staff command only to devices that belong to the staff's school.
  async function relayCommand(event: string, raw: unknown, schoolId: string): Promise<void> {
    const parsed = RecordingCommandSchema.safeParse(raw);
    if (!parsed.success) return;
    const devices = await prisma.device.findMany({
      where: { id: { in: parsed.data.deviceIds }, schoolId },
      select: { id: true },
    });
    for (const device of devices) {
      io.to(deviceRoom(device.id)).emit(event);
    }
  }

  app.addHook('onClose', (_instance, done) => {
    io.close();
    done();
  });

  return io;
}

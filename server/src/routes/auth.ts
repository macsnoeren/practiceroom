import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  LoginSchema,
  RegisterSchoolSchema,
  TwoFactorCodeSchema,
  UpdateProfileSchema,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { cookieSecure } from '../env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/session.js';
import { requireAuth } from '../auth/plugin.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { toSchoolDto, toUserDto } from '../lib/dto.js';
import { sensitiveRateLimit } from '../lib/rate-limit.js';
import { audit } from '../lib/audit.js';
import { generateTotpSecret, totpKeyUri, verifyTotp } from '../lib/totp.js';

function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Bootstrap a school + its first admin. Open by design for a self-hosted
  // install; tighten or disable once the school exists (see Phase 8).
  app.post('/api/auth/register-school', sensitiveRateLimit, async (request, reply) => {
    const input = RegisterSchoolSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('E-mailadres is al in gebruik');

    const passwordHash = await hashPassword(input.password);
    const { school, admin } = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({ data: { name: input.schoolName } });
      const admin = await tx.user.create({
        data: {
          schoolId: school.id,
          email: input.email,
          name: input.adminName,
          role: 'admin',
          passwordHash,
        },
      });
      return { school, admin };
    });

    const session = await createSession(admin.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    audit(request, 'school.register', { schoolId: school.id, userId: admin.id });
    return reply.code(201).send({ user: toUserDto(admin), school: toSchoolDto(school) });
  });

  app.post('/api/auth/login', sensitiveRateLimit, async (request, reply) => {
    const input = LoginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Spend similar time as a real verify to reduce user enumeration.
      await hashPassword(input.password);
      audit(request, 'auth.login_failed', { email: input.email });
      throw unauthorized('Onjuiste inloggegevens');
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      audit(request, 'auth.login_failed', { email: input.email });
      throw unauthorized('Onjuiste inloggegevens');
    }

    // Second factor (TOTP), if the account has it enabled.
    if (user.totpEnabled) {
      if (!input.code) {
        return reply.code(401).send({ error: 'Tweestapsverificatie vereist', twofa: true });
      }
      if (!user.totpSecret || !verifyTotp(input.code, user.totpSecret)) {
        audit(request, 'auth.login_failed', { email: input.email, twofa: true });
        return reply.code(401).send({ error: 'Onjuiste verificatiecode', twofa: true });
      }
    }

    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    audit(request, 'auth.login', { userId: user.id });
    return toUserDto(user);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const authUser = requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) throw unauthorized();
    return toUserDto(user);
  });

  // A user updates their own profile (name, email, password).
  app.patch('/api/auth/me', async (request) => {
    const me = requireAuth(request);
    const input = UpdateProfileSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw unauthorized();

    if (input.email && input.email !== user.email) {
      const taken = await prisma.user.findUnique({ where: { email: input.email } });
      if (taken) throw conflict('E-mailadres is al in gebruik');
    }

    let passwordHash: string | undefined;
    if (input.newPassword) {
      const valid =
        !!input.currentPassword && (await verifyPassword(user.passwordHash, input.currentPassword));
      if (!valid) throw unauthorized('Huidig wachtwoord klopt niet');
      passwordHash = await hashPassword(input.newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { name: input.name, email: input.email, ...(passwordHash ? { passwordHash } : {}) },
    });
    audit(request, 'profile.update', { userId: me.id });
    return toUserDto(updated);
  });

  /* ---- Two-factor authentication (TOTP) ------------------------------------ */

  // Start setup: generate a secret and return the otpauth URL (for a QR code).
  app.post('/api/auth/2fa/setup', async (request) => {
    const me = requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw unauthorized();
    if (user.totpEnabled) throw badRequest('Tweestapsverificatie staat al aan');

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: me.id },
      data: { totpSecret: secret, totpEnabled: false },
    });
    return { otpauthUrl: totpKeyUri(user.email, secret), secret };
  });

  // Confirm setup with a code from the authenticator app.
  app.post('/api/auth/2fa/enable', async (request) => {
    const me = requireAuth(request);
    const { code } = TwoFactorCodeSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !user.totpSecret) throw badRequest('Start eerst de instelling van 2FA');
    if (!verifyTotp(code, user.totpSecret)) throw badRequest('Onjuiste code');

    await prisma.user.update({ where: { id: me.id }, data: { totpEnabled: true } });
    audit(request, '2fa.enable', { userId: me.id });
    return { ok: true };
  });

  // Turn 2FA off (requires a valid current code).
  app.post('/api/auth/2fa/disable', async (request) => {
    const me = requireAuth(request);
    const { code } = TwoFactorCodeSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      throw badRequest('Tweestapsverificatie staat niet aan');
    }
    if (!verifyTotp(code, user.totpSecret)) throw badRequest('Onjuiste code');

    await prisma.user.update({
      where: { id: me.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    audit(request, '2fa.disable', { userId: me.id });
    return { ok: true };
  });
}

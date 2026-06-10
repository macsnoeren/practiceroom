import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AcceptInviteSchema,
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchoolSchema,
  ResetPasswordSchema,
  TokenSchema,
  TwoFactorCodeSchema,
  UpdateProfileSchema,
} from '@practiceroom/shared';
import { prisma } from '../db.js';
import { cookieSecure } from '../env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/session.js';
import { requireAuth } from '../auth/plugin.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { toSchoolDto, toUserDto } from '../lib/dto.js';
import { sensitiveRateLimit } from '../lib/rate-limit.js';
import { audit } from '../lib/audit.js';
import { generateTotpSecret, totpKeyUri, verifyTotp } from '../lib/totp.js';
import { consumeToken, createToken, peekToken } from '../lib/token.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/mailer.js';

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

    // Send a verification e-mail, but let them in right away (soft verify).
    const token = await createToken(admin.id, 'email_verify');
    await sendVerificationEmail(admin.email, admin.name, token);

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
    // Use the raw principal so a superadmin without an entered school still works.
    const principal = request.principal;
    if (!principal) throw unauthorized();
    const user = await prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user) throw unauthorized();
    return toUserDto(user, principal.activeSchoolId);
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

  /* ---- E-mail verification ------------------------------------------------- */

  // Confirm an e-mail address from a link. Works whether or not logged in.
  app.post('/api/auth/verify-email', async (request) => {
    const { token } = TokenSchema.parse(request.body);
    const userId = await consumeToken(token, 'email_verify');
    if (!userId) throw badRequest('Deze verificatielink is ongeldig of verlopen');

    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    audit(request, 'email.verify', { userId });
    return { ok: true };
  });

  // Resend the verification e-mail to the logged-in user.
  app.post('/api/auth/verify-email/resend', sensitiveRateLimit, async (request) => {
    const me = requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw unauthorized();
    if (user.emailVerified) return { ok: true };

    const token = await createToken(user.id, 'email_verify');
    await sendVerificationEmail(user.email, user.name, token);
    return { ok: true };
  });

  /* ---- Password reset ------------------------------------------------------ */

  // Always responds ok so it cannot be used to probe which e-mails exist.
  app.post('/api/auth/forgot-password', sensitiveRateLimit, async (request) => {
    const { email } = ForgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createToken(user.id, 'password_reset');
      await sendPasswordResetEmail(user.email, user.name, token);
      audit(request, 'password.reset_requested', { userId: user.id });
    }
    return { ok: true };
  });

  app.post('/api/auth/reset-password', sensitiveRateLimit, async (request) => {
    const { token, password } = ResetPasswordSchema.parse(request.body);
    const userId = await consumeToken(token, 'password_reset');
    if (!userId) throw badRequest('Deze herstellink is ongeldig of verlopen');

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // Invalidate existing sessions so a reset also kicks out a thief.
      prisma.session.deleteMany({ where: { userId } }),
    ]);
    audit(request, 'password.reset', { userId });
    return { ok: true };
  });

  /* ---- Invitations --------------------------------------------------------- */

  // Preview an invite (who it is for) without consuming the token.
  app.get('/api/auth/invite', async (request) => {
    const { token } = TokenSchema.parse(request.query);
    const userId = await peekToken(token, 'invite');
    if (!userId) throw notFound('Deze uitnodiging is ongeldig of verlopen');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('Deze uitnodiging is ongeldig of verlopen');
    return { email: user.email, name: user.name };
  });

  // Accept an invite: set a password, verify the e-mail, and log in.
  app.post('/api/auth/accept-invite', sensitiveRateLimit, async (request, reply) => {
    const input = AcceptInviteSchema.parse(request.body);
    const userId = await consumeToken(input.token, 'invite');
    if (!userId) throw badRequest('Deze uitnodiging is ongeldig of verlopen');

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerified: true, ...(input.name ? { name: input.name } : {}) },
    });

    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    audit(request, 'invite.accept', { userId });
    return toUserDto(user);
  });
}

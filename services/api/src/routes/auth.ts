import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../auth/crypto.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '../auth/tokens.js';
import { prisma } from '../db.js';
import { AppError, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { parse, rateLimit, saudiPhone } from '../lib/http.js';
import { randomInt } from 'node:crypto';

const OTP_TTL_MS = 5 * 60_000;
const DUMMY_HASH = await hashPassword('dummy-password-for-timing-only');
const OTP_MAX_ATTEMPTS = 5;

export async function issueSession(deps: Deps, userId: string, userAgent?: string) {
  const refreshToken = randomToken(32);
  await prisma.authSession.create({
    data: { userId, refreshTokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000), userAgent },
  });
  return { accessToken: await deps.tokens.signAccessToken(userId), refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, tokenType: 'Bearer' };
}

export async function authRoutes(app: FastifyInstance, deps: Deps) {
  const { config } = deps.ctx;
  const localOnly = () => {
    if (config.AUTH_MODE !== 'local') throw new AppError(404, 'NOT_FOUND', 'Use Amazon Cognito to sign in');
  };
  const limited = rateLimit(config.RATE_LIMIT_SCALE, 10, '1 minute');

  /** Phone OTP. No SMS provider is connected yet: in non-production the code is returned as `sandboxCode`. */
  app.post('/v1/auth/otp/request', limited, async (req) => {
    localOnly();
    const { phone } = parse(z.object({ phone: saudiPhone }), req.body);
    const recent = await prisma.otpChallenge.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 5 * config.RATE_LIMIT_SCALE) throw new AppError(429, 'RATE_LIMITED', 'Too many codes requested; try again later');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await prisma.otpChallenge.create({ data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
    return { sent: false, channel: 'sandbox', expiresInSeconds: OTP_TTL_MS / 1000, ...(config.NODE_ENV !== 'production' ? { sandboxCode: code } : {}) };
  });

  app.post('/v1/auth/otp/verify', limited, async (req) => {
    localOnly();
    const body = parse(z.object({ phone: saudiPhone, code: z.string().regex(/^\d{6}$/), name: z.string().min(2).max(80).optional() }), req.body);
    const challenge = await prisma.otpChallenge.findFirst({ where: { phone: body.phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!challenge || challenge.expiresAt < new Date() || challenge.attempts >= OTP_MAX_ATTEMPTS) throw unauthorized('Code expired; request a new one');
    if (challenge.codeHash !== sha256(`${body.phone}:${body.code}`)) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw unauthorized('Incorrect code');
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    const user = await prisma.user.upsert({ where: { phone: body.phone }, update: {}, create: { phone: body.phone, name: body.name } });
    if (user.status !== 'ACTIVE') throw unauthorized('Account unavailable');
    if (body.name && !user.name) await prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
    return { user: { id: user.id, phone: user.phone, name: user.name ?? body.name ?? null }, ...(await issueSession(deps, user.id, req.headers['user-agent'])) };
  });

  /** Email + password for merchant and Qitah staff (local mode). */
  app.post('/v1/auth/login', limited, async (req) => {
    localOnly();
    const body = parse(z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Always run scrypt so response time does not reveal whether the email exists.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.status !== 'ACTIVE') throw unauthorized('Incorrect email or password');
    return issueSession(deps, user.id, req.headers['user-agent']);
  });

  app.post('/v1/auth/refresh', limited, async (req) => {
    localOnly();
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    const session = await prisma.authSession.findUnique({ where: { refreshTokenHash: sha256(refreshToken) }, include: { user: true } });
    if (session?.revokedAt) {
      // A rotated refresh token was replayed: assume theft and end every session of this user.
      await prisma.authSession.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw unauthorized('Session expired');
    }
    if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') throw unauthorized('Session expired');
    // Rotation: the old refresh token is revoked on use.
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return issueSession(deps, session.userId, req.headers['user-agent']);
  });

  app.post('/v1/auth/logout', async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    await prisma.authSession.updateMany({ where: { refreshTokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  });

  app.get('/v1/me', async (req) => {
    const p = await deps.guards.requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    const merchants = await prisma.merchant.findMany({ where: { id: { in: p.memberships.map((m) => m.merchantId) } } });
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      platformRoles: p.platformRoles,
      merchants: p.memberships.map((m) => {
        const merchant = merchants.find((x) => x.id === m.merchantId)!;
        return { id: m.merchantId, role: m.role, displayNameAr: merchant.displayNameAr, displayNameEn: merchant.displayNameEn, status: merchant.status };
      }),
    };
  });

  app.patch('/v1/me', async (req) => {
    const p = await deps.guards.requireUser(req);
    const body = parse(z.object({ name: z.string().min(2).max(80).optional(), email: z.string().email().toLowerCase().optional() }), req.body);
    const user = await prisma.user.update({ where: { id: p.userId }, data: body });
    return { id: user.id, phone: user.phone, email: user.email, name: user.name };
  });

  app.post('/v1/me/password', limited, async (req) => {
    localOnly();
    const p = await deps.guards.requireUser(req);
    const body = parse(z.object({ current: z.string(), next: z.string().min(10).max(200) }), req.body);
    const user = await prisma.user.findUnique({ where: { id: p.userId } });
    if (!user) throw notFound('User');
    if (!(await verifyPassword(body.current, user.passwordHash))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
    await prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  });
}

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';

import { createGuards, type Guards } from './auth/principal.js';
import { createTokenService, type TokenService } from './auth/tokens.js';
import type { Config } from './config.js';
import { createContext, type Ctx } from './context.js';
import { prisma } from './db.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { customerRoutes } from './routes/customer.js';
import { eventRoutes } from './routes/events.js';
import { garageRoutes } from './routes/garage.js';
import { mechanicPublicRoutes } from './routes/mechanic.js';
import { merchantRoutes, merchantUploadRoutes } from './routes/merchant.js';
import { opsRoutes } from './routes/ops.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { localUploadRoutes } from './routes/uploads.js';
import { webhookRoutes } from './routes/webhooks.js';

export type Deps = { ctx: Ctx; tokens: TokenService; guards: Guards; app: FastifyInstance };

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp(config: Config, overrides: Partial<Ctx> = {}) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
    // Only trust X-Forwarded-For from known proxy hops; a client cannot spoof its IP to dodge rate limits.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 2 * 1024 * 1024,
  });
  const ctx = { ...createContext(config), ...overrides };
  const tokens = createTokenService(config);
  const guards = createGuards(tokens);
  const deps: Deps = { ctx, tokens, guards, app };

  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, { origin: origins.length ? origins : false, credentials: false, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { global: false });

  // Keep the raw body for signature verification on webhook routes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = body as string;
    req.rawBody = text;
    if (!text) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, 'INVALID_JSON', 'Body is not valid JSON'), undefined);
    }
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({ error: { code: 'ALREADY_EXISTS', message: 'A record with these details already exists', details: error.meta } });
    }
    req.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal error' } });
  });

  app.get('/health', async () => ({ ok: true, service: 'qitah-api', env: config.NODE_ENV, sandbox: config.sandbox }));
  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await app.register(async (s) => authRoutes(s, deps));
  await app.register(async (s) => catalogRoutes(s, deps));
  await app.register(async (s) => customerRoutes(s, deps));
  await app.register(async (s) => merchantRoutes(s, deps));
  await app.register(async (s) => merchantUploadRoutes(s, deps));
  await app.register(async (s) => localUploadRoutes(s, deps));
  await app.register(async (s) => opsRoutes(s, deps));
  await app.register(async (s) => webhookRoutes(s, deps));
  await app.register(async (s) => eventRoutes(s, deps));
  await app.register(async (s) => garageRoutes(s, deps));
  await app.register(async (s) => mechanicPublicRoutes(s, deps));
  if (config.sandbox) await app.register(async (s) => sandboxRoutes(s, deps));
  return app;
}

/** Delivers a webhook through the real route (signature verification included) without network hops. */
export async function deliverInProcess(app: FastifyInstance, d: { url: string; body: string; headers: Record<string, string> }) {
  const res = await app.inject({ method: 'POST', url: d.url, payload: d.body, headers: d.headers });
  return { statusCode: res.statusCode, body: res.json() as unknown };
}

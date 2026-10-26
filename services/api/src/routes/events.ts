import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { parse } from '../lib/http.js';

/**
 * Realtime: domain events (outbox) filtered by the caller's scope.
 * - GET /v1/events?after=<id>   polling (mobile app)
 * - GET /v1/events/stream        Server-Sent Events (portals, via their server-side proxy)
 * Postgres-backed so it works across multiple API tasks without extra infrastructure.
 */
export async function eventRoutes(app: FastifyInstance, deps: Deps) {
  async function scopeFor(req: FastifyRequest): Promise<Prisma.DomainEventWhereInput> {
    const q = parse(z.object({ scope: z.enum(['customer', 'merchant', 'ops']).default('customer'), merchantId: z.string().optional() }), req.query);
    if (q.scope === 'ops') {
      await deps.guards.requirePlatform(req);
      return {};
    }
    if (q.scope === 'merchant') {
      if (!q.merchantId) throw forbidden('merchantId required');
      await deps.guards.requireMerchant(req, q.merchantId);
      return { merchantIds: { has: q.merchantId }, type: { notIn: ['order.created', 'order.expired'] } };
    }
    const p = await deps.guards.requireUser(req);
    return { customerId: p.userId };
  }

  const present = (e: { id: bigint; type: string; entityType: string; entityId: string; orderId: string | null; payload: Prisma.JsonValue; createdAt: Date }) => ({
    id: e.id.toString(),
    type: e.type,
    entityType: e.entityType,
    entityId: e.entityId,
    orderId: e.orderId,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  });

  app.get('/v1/events', async (req) => {
    const where = await scopeFor(req);
    const { after } = parse(z.object({ after: z.string().regex(/^\d+$/).optional() }), req.query);
    const latest = after ? undefined : await prisma.domainEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    const rows = after ? await prisma.domainEvent.findMany({ where: { ...where, id: { gt: BigInt(after) } }, orderBy: { id: 'asc' }, take: 200 }) : [];
    return { events: rows.map(present), cursor: (rows.at(-1)?.id ?? latest?.id ?? BigInt(after ?? 0)).toString() };
  });

  app.get('/v1/events/stream', async (req, reply) => {
    const where = await scopeFor(req);
    const last = await prisma.domainEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    let cursor = last?.id ?? 0n;
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(`event: ready\ndata: {"cursor":"${cursor}"}\n\n`);
    let closed = false;
    req.raw.on('close', () => (closed = true));
    let ticks = 0;
    while (!closed) {
      const rows = await prisma.domainEvent.findMany({ where: { ...where, id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 100 });
      for (const r of rows) {
        cursor = r.id;
        reply.raw.write(`id: ${r.id}\nevent: ${r.type}\ndata: ${JSON.stringify(present(r))}\n\n`);
      }
      if (++ticks % 10 === 0) reply.raw.write(`: keepalive\n\n`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    reply.raw.end();
  });
}

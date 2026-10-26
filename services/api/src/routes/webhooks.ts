import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { hmacSha256, safeEqualHex } from '../auth/crypto.js';
import { prisma } from '../db.js';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { SANDBOX_SIGNATURE_HEADER } from '../providers/payment/sandbox.js';
import { handlePaymentWebhook } from '../services/payments.js';
import { recordTrackingEvent } from '../services/shipping.js';

const carrierEvent = z.object({
  id: z.string().min(4).max(100),
  trackingNumber: z.string().max(60),
  status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION', 'RETURNED_TO_SENDER']),
  description: z.string().max(300),
  location: z.string().max(120).optional(),
  occurredAt: z.coerce.date(),
});

function verifySandboxSignature(secret: string, raw: string, header: unknown) {
  if (typeof header !== 'string') throw new AppError(401, 'BAD_SIGNATURE', 'Missing signature');
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) throw new AppError(401, 'BAD_SIGNATURE', 'Stale signature');
  if (!parts.v1 || !safeEqualHex(parts.v1, hmacSha256(secret, `${t}.${raw}`))) throw new AppError(401, 'BAD_SIGNATURE', 'Bad signature');
}

export async function webhookRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.post('/v1/webhooks/payments/:provider', async (req, reply) => {
    const { provider } = parse(z.object({ provider: z.string() }), req.params);
    if (provider !== ctx.payments.code) throw new AppError(404, 'NOT_FOUND', 'Unknown provider');
    let event;
    try {
      event = ctx.payments.verifyWebhook(req.rawBody ?? '', req.headers);
    } catch (e) {
      req.log.warn({ err: String(e) }, 'rejected payment webhook');
      return reply.code(401).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } });
    }
    const result = await handlePaymentWebhook(ctx, event);
    return { received: true, ...result };
  });

  app.post('/v1/webhooks/carriers/:carrier', async (req) => {
    const { carrier } = parse(z.object({ carrier: z.string() }), req.params);
    if (carrier !== ctx.carrier.code) throw new AppError(404, 'NOT_FOUND', 'Unknown carrier');
    verifySandboxSignature(ctx.config.CARRIER_WEBHOOK_SECRET, req.rawBody ?? '', req.headers[SANDBOX_SIGNATURE_HEADER]);
    const e = parse(carrierEvent, req.body);
    const shipment = await prisma.shipment.findUnique({ where: { trackingNumber: e.trackingNumber } });
    if (!shipment) return { received: true, outcome: 'ignored', detail: 'UNKNOWN_TRACKING_NUMBER' };
    try {
      const r = await recordTrackingEvent({
        shipmentId: shipment.id,
        status: e.status,
        description: e.description,
        location: e.location,
        source: 'CARRIER',
        externalEventId: `${carrier}:${e.id}`,
        occurredAt: e.occurredAt,
        actor: { type: 'carrier' },
      });
      return { received: true, outcome: r.applied ? 'processed' : 'duplicate' };
    } catch (err) {
      // Out-of-order or invalid scans are acknowledged (so the carrier stops retrying) but flagged for ops.
      if (err instanceof AppError && err.statusCode === 409) return { received: true, outcome: 'rejected', detail: err.message };
      throw err;
    }
  });
}

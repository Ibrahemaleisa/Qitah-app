import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { parse, rateLimit } from '../lib/http.js';
import { decodeVin } from '../lib/vin.js';
import { deleteServiceRecord, recordService, vehicleMaintenance } from '../services/maintenance.js';
import { createMechanicReview, getMechanicReview, listMechanicReviews } from '../services/mechanicReviews.js';

/** Faster garage (offline VIN decode), maintenance schedule/kits and "send to my mechanic" (customer side). */
export async function garageRoutes(app: FastifyInstance, deps: Deps) {
  const { requireUser } = deps.guards;
  const { ctx } = deps;

  /**
   * Offline partial VIN decode: manufacturer (WMI) + model year (position 10). Never the model or
   * engine. Public (used before sign-in), rate-limited.
   */
  app.post('/v1/vin/decode', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '1 minute'), async (req) => {
    const { vin } = parse(z.object({ vin: z.string().max(40) }), req.body);
    const d = decodeVin(vin);
    // Only claim a catalog make that actually exists in this deployment's catalog.
    const make = d.make ? await prisma.vehicleMake.findUnique({ where: { id: d.make } }) : null;
    return {
      valid: d.valid,
      make: make ? { id: make.id, name: { ar: make.nameAr, en: make.nameEn } } : undefined,
      manufacturer: d.manufacturer,
      modelYear: d.modelYear,
      wmi: d.wmi,
      region: d.region,
      checkDigit: d.checkDigit,
      confidence: d.make && !make ? 'low' : d.confidence,
      reasons: d.make && !make ? [...d.reasons.filter((r) => r !== 'model_engine_required'), 'make_not_in_catalog'] : d.reasons,
      note: d.note,
      noteAr: d.noteAr,
    };
  });

  // ── maintenance
  app.get('/v1/me/vehicles/:id/maintenance', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    return vehicleMaintenance(p.userId, id);
  });

  app.post('/v1/me/vehicles/:id/service-records', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '1 minute'), async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    const body = parse(
      z.object({
        serviceCode: z.string().max(40),
        doneAtKm: z.number().int().min(0).max(3_000_000).optional(),
        doneAt: z.string().datetime().optional(),
        variant: z.string().max(40).optional(),
        orderItemId: z.string().max(64).optional(),
      }),
      req.body,
    );
    return recordService(p.userId, id, body);
  });

  app.delete('/v1/me/vehicles/:id/service-records/:recordId', async (req) => {
    const p = await requireUser(req);
    const { id, recordId } = parse(z.object({ id: z.string().max(64), recordId: z.string().max(64) }), req.params);
    await deleteServiceRecord(p.userId, id, recordId);
    return { ok: true };
  });

  // ── send to my mechanic (customer side)
  app.post('/v1/me/mechanic-reviews', rateLimit(ctx.config.RATE_LIMIT_SCALE, 10, '1 minute'), async (req) => {
    const p = await requireUser(req);
    const body = parse(
      z.object({
        lines: z.array(z.object({ offerId: z.string().max(64), quantity: z.number().int().min(1).max(20) })).min(1).max(20),
        vehicleId: z.string().max(64).optional(),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    return createMechanicReview(p.userId, body, ctx.config.PUBLIC_BASE_URL);
  });

  app.get('/v1/me/mechanic-reviews', async (req) => {
    const p = await requireUser(req);
    return { reviews: await listMechanicReviews(p.userId) };
  });

  app.get('/v1/me/mechanic-reviews/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    return getMechanicReview(p.userId, id);
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { cityId, pageQuery, parse, rateLimit } from '../lib/http.js';
import {
  acceptQuote,
  cancelPartRequest,
  createPartRequest,
  customerPhotoPrefix,
  DEFAULT_QUOTE_VALID_HOURS,
  getCustomerRequest,
  getMerchantRequest,
  listCustomerRequests,
  listMerchantInbox,
  listMerchantQuotes,
  MAX_PHOTOS,
  MAX_QUOTE_VALID_HOURS,
  opsGetRequest,
  opsListRequests,
  privateCatalogForUser,
  submitQuote,
  updateQuote,
  withdrawQuote,
} from '../services/partRequests.js';

/** "123.45" → 12345 halalas with string math (no floating point). */
export function sarStringToHalalas(value: string): number {
  const m = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(value);
  if (!m) throw badRequest('INVALID_PRICE', `Invalid SAR amount "${value}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
const id = z.string().min(1).max(64);

const quoteFields = {
  productId: id.nullable().optional(),
  partName: z.string().min(2).max(160).optional(),
  brand: z.string().min(1).max(80).optional(),
  partNumber: z.string().min(2).max(60).optional(),
  categoryId: z.string().max(40).optional(),
  origin: z.enum(['OEM', 'AFTERMARKET']).optional(),
  condition: z.enum(['NEW', 'USED', 'REFURBISHED']),
  /** Either a SAR string ("149.50", converted with string math) or integer halalas. */
  priceSar: z.string().max(12).optional(),
  priceHalalas: z.number().int().positive().max(100_000_000).optional(),
  quantity: z.number().int().min(1).max(20).optional(),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  dispatchDaysMin: z.number().int().min(0).max(30).default(0),
  dispatchDaysMax: z.number().int().min(0).max(30).default(1),
  locationId: id,
  photoKey: z.string().max(300).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  validHours: z.number().int().min(1).max(MAX_QUOTE_VALID_HOURS).default(DEFAULT_QUOTE_VALID_HOURS),
};
const createQuoteBody = z.object(quoteFields);
const updateQuoteBody = z.object({
  ...quoteFields,
  condition: quoteFields.condition.optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  dispatchDaysMin: z.number().int().min(0).max(30).optional(),
  dispatchDaysMax: z.number().int().min(0).max(30).optional(),
  locationId: id.optional(),
  validHours: z.number().int().min(1).max(MAX_QUOTE_VALID_HOURS).optional(),
});

function price(body: { priceSar?: string; priceHalalas?: number }, required: boolean) {
  const halalas = body.priceSar !== undefined ? sarStringToHalalas(body.priceSar) : body.priceHalalas;
  if (halalas !== undefined && halalas <= 0) throw badRequest('INVALID_PRICE', 'Price must be greater than zero');
  if (required && halalas === undefined) throw badRequest('INVALID_PRICE', 'Enter a price');
  return halalas;
}

export async function partRequestRoutes(app: FastifyInstance, deps: Deps) {
  const { requireUser, requireMerchant, requirePlatform } = deps.guards;
  const { ctx } = deps;
  const mid = (req: FastifyRequest) => parse(z.object({ merchantId: id }), req.params).merchantId;
  const rid = (req: FastifyRequest) => parse(z.object({ id }), req.params).id;

  // ── customer
  // Customer photo uploads go through POST /v1/me/uploads (purpose 'part-request') in routes/customer.ts.

  app.post('/v1/me/part-requests', rateLimit(ctx.config.RATE_LIMIT_SCALE, 10, '10 minutes'), async (req) => {
    const p = await requireUser(req);
    const body = parse(
      z
        .object({
          vehicleId: id.optional(),
          vehicle: z.object({ modelId: z.string().max(60), year: z.number().int().min(1950).max(2100), engine: z.string().max(60).optional(), vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i).optional() }).optional(),
          description: z.string().max(1000).default(''),
          partNumber: z.string().max(60).optional(),
          quantity: z.number().int().min(1).max(20).default(1),
          photoKeys: z.array(z.string().max(300)).max(MAX_PHOTOS).default([]),
          preferredCondition: z.enum(['ANY', 'NEW', 'USED']).default('ANY'),
          preferredOrigin: z.enum(['ANY', 'OEM', 'AFTERMARKET']).default('ANY'),
          addressId: id.optional(),
          city: cityId.optional(),
        })
        .refine((b) => b.vehicleId || b.vehicle, { message: 'vehicleId or vehicle is required', path: ['vehicleId'] }),
      req.body,
    );
    return createPartRequest(ctx, p.userId, body);
  });

  app.get('/v1/me/part-requests', async (req) => {
    const p = await requireUser(req);
    return { requests: await listCustomerRequests(p.userId) };
  });

  app.get('/v1/me/part-requests/:id', async (req) => {
    const p = await requireUser(req);
    return getCustomerRequest(ctx, p.userId, rid(req));
  });

  app.post('/v1/me/part-requests/:id/cancel', async (req) => {
    const p = await requireUser(req);
    await cancelPartRequest(p.userId, rid(req));
    return getCustomerRequest(ctx, p.userId, rid(req));
  });

  app.post('/v1/me/part-requests/:id/quotes/:quoteId/accept', async (req) => {
    const p = await requireUser(req);
    const params = parse(z.object({ id, quoteId: id }), req.params);
    return acceptQuote(p.userId, params.id, params.quoteId);
  });

  /** The customer's live private offers (from accepted quotes) in the catalog shape, for the cart. */
  app.get('/v1/me/private-offers', async (req) => {
    const p = await requireUser(req);
    return privateCatalogForUser(p.userId);
  });

  // ── merchant (all under /v1/merchants/**, already allowed by the merchant portal proxy)
  async function requireApprovedMerchant(req: FastifyRequest, merchantId: string) {
    const r = await requireMerchant(req, merchantId);
    const m = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { status: true } });
    if (m?.status !== 'APPROVED') throw forbidden('Your store must be approved by Qitah before answering part requests');
    return r;
  }

  app.get('/v1/merchants/:merchantId/part-requests', async (req) => {
    const merchantId = mid(req);
    await requireApprovedMerchant(req, merchantId);
    return listMerchantInbox(merchantId);
  });

  app.get('/v1/merchants/:merchantId/part-requests/:id', async (req) => {
    const merchantId = mid(req);
    await requireApprovedMerchant(req, merchantId);
    return getMerchantRequest(ctx, merchantId, rid(req));
  });

  app.post('/v1/merchants/:merchantId/part-requests/:id/quote', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireApprovedMerchant(req, merchantId);
    const body = parse(createQuoteBody, req.body);
    const { priceSar: _s, priceHalalas: _h, ...rest } = body;
    return submitQuote(merchantId, p.userId, rid(req), { ...rest, priceHalalas: price(body, true)! });
  });

  app.patch('/v1/merchants/:merchantId/part-requests/:id/quote', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireApprovedMerchant(req, merchantId);
    const body = parse(updateQuoteBody, req.body);
    const { priceSar: _s, priceHalalas: _h, ...rest } = body;
    const halalas = price(body, false);
    return updateQuote(merchantId, p.userId, rid(req), { ...rest, ...(halalas !== undefined ? { priceHalalas: halalas } : {}) });
  });

  app.post('/v1/merchants/:merchantId/part-requests/:id/quote/withdraw', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId);
    return withdrawQuote(merchantId, p.userId, rid(req));
  });

  app.get('/v1/merchants/:merchantId/part-quotes', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const q = parse(z.object({ status: z.string().max(80).optional() }), req.query);
    return listMerchantQuotes(merchantId, q.status);
  });

  // ── ops (read-only)
  app.get('/v1/ops/part-requests', async (req) => {
    await requirePlatform(req, ['OPS_AGENT', 'OPS_ADMIN']);
    const q = parse(pageQuery.extend({ status: z.enum(['OPEN', 'QUOTED', 'ACCEPTED', 'EXPIRED', 'CANCELLED']).optional() }), req.query);
    return opsListRequests(q);
  });

  app.get('/v1/ops/part-requests/:id', async (req) => {
    await requirePlatform(req, ['OPS_AGENT', 'OPS_ADMIN']);
    return opsGetRequest(ctx, rid(req));
  });
}

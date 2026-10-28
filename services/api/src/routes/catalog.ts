import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { cityId, pageQuery, parse } from '../lib/http.js';
import { catalogSnapshot, getProductDetail, offersByIds, presentSellers, referenceData } from '../services/catalog.js';
import { searchCatalog, searchProducts } from '../services/search.js';
import { deliveryEstimates, returnPolicy } from '../services/trust.js';

const bool = z.enum(['true', 'false']).optional().transform((v) => v === 'true');
const list = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .max(100)
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

/** Vehicle filter: `modelId`, `year`, `engine` — or the compact `vehicle=modelId:year:engine`. */
const vehicleQuery = {
  modelId: z.string().max(60).optional(),
  year: z.coerce.number().int().min(1950).max(2100).optional(),
  engine: z.string().max(60).optional(),
  vehicle: z.string().max(140).optional(),
};

function withVehicle<T extends { modelId?: string; year?: number; engine?: string; vehicle?: string }>(q: T) {
  if (!q.vehicle) return q;
  const [modelId, year, ...engine] = q.vehicle.split(':');
  const y = Number(year);
  return { ...q, modelId: q.modelId ?? (modelId || undefined), year: q.year ?? (Number.isInteger(y) && y >= 1950 && y <= 2100 ? y : undefined), engine: q.engine ?? (engine.join(':') || undefined) };
}

export async function catalogRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;
  app.get('/v1/catalog/reference', async () => referenceData());

  app.get('/v1/catalog/snapshot', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return catalogSnapshot();
  });

  /**
   * Relevance-ranked search that understands colloquial part names and vehicles typed in the query.
   * See services/search.ts for matching/ranking and docs in services/api/README.md for the contract.
   */
  app.get('/v1/catalog/search', async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        categoryId: z.string().max(40).optional(),
        ...vehicleQuery,
        fitsOnly: bool,
        origin: list(['oem', 'aftermarket'] as const),
        condition: list(['new', 'used', 'refurbished'] as const),
        inStock: bool,
        sort: z.enum(['relevance', 'priceAsc', 'priceDesc', 'fastest']).optional(),
        cursor: z.string().max(400).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
    );
    const v = withVehicle(q);
    return searchProducts({
      q: v.q,
      categoryId: v.categoryId,
      modelId: v.modelId,
      year: v.year,
      engine: v.engine,
      fitsOnly: v.fitsOnly,
      origins: v.origin,
      conditions: v.condition,
      inStock: v.inStock,
      sort: v.sort,
      cursor: v.cursor,
      limit: v.limit,
    });
  });

  /** Legacy offset-paged list; delegates to the ranked search. */
  app.get('/v1/catalog/products', async (req) => {
    const q = parse(
      pageQuery.extend({
        q: z.string().max(100).optional(),
        categoryId: z.string().max(40).optional(),
        ...vehicleQuery,
        fitsOnly: bool,
      }),
      req.query,
    );
    const v = withVehicle(q);
    return searchCatalog({ q: v.q, categoryId: v.categoryId, modelId: v.modelId, year: v.year, engine: v.engine, fitsOnly: v.fitsOnly, limit: v.limit, offset: v.offset });
  });

  app.get('/v1/catalog/products/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    return getProductDetail(id);
  });

  /** Live price/stock for cart lines. */
  app.get('/v1/catalog/offers', async (req) => {
    const { ids } = parse(z.object({ ids: z.string().max(2000) }), req.query);
    return { offers: await offersByIds(ids.split(',').filter(Boolean).slice(0, 50)) };
  });

  /**
   * Delivered price + arrival estimate per offer for the customer's city (public). Estimates only ("تقديري"):
   * the binding price is the checkout plan. Same-day honours each location's cutoff and the merchant's dispatch days.
   */
  app.get('/v1/catalog/delivery-estimates', async (req, reply) => {
    const q = parse(z.object({ offerIds: z.string().min(1).max(2000), city: cityId }), req.query);
    const ids = [...new Set(q.offerIds.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 50);
    reply.header('cache-control', 'public, max-age=60');
    return { city: q.city, generatedAt: ctx.clock().toISOString(), estimates: await deliveryEstimates(ctx, ids, q.city) };
  });

  /** The return policy shown before purchase (window, who pays return shipping per reason, refund timing). */
  app.get('/v1/catalog/return-policy', async () => returnPolicy(ctx.config.RETURN_WINDOW_DAYS));

  app.get('/v1/catalog/sellers/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    const merchant = await prisma.merchant.findFirst({ where: { id, status: 'APPROVED' } });
    if (!merchant) throw notFound('Seller');
    const [seller] = await presentSellers([id]);
    const products = await searchCatalog({ merchantId: id, limit: 100, offset: 0 });
    return { seller, products: products.items };
  });
}

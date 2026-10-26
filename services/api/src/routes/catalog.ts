import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { pageQuery, parse } from '../lib/http.js';
import { catalogSnapshot, getProductDetail, offersByIds, presentSellers, referenceData, searchCatalog } from '../services/catalog.js';

export async function catalogRoutes(app: FastifyInstance, _deps: Deps) {
  app.get('/v1/catalog/reference', async () => referenceData());

  app.get('/v1/catalog/snapshot', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return catalogSnapshot();
  });

  app.get('/v1/catalog/products', async (req) => {
    const q = parse(
      pageQuery.extend({
        q: z.string().max(100).optional(),
        categoryId: z.string().max(40).optional(),
        modelId: z.string().max(60).optional(),
        year: z.coerce.number().int().min(1950).max(2100).optional(),
        engine: z.string().max(60).optional(),
        fitsOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
      }),
      req.query,
    );
    return searchCatalog(q);
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

  app.get('/v1/catalog/sellers/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    const merchant = await prisma.merchant.findFirst({ where: { id, status: 'APPROVED' } });
    if (!merchant) throw notFound('Seller');
    const [seller] = await presentSellers([id]);
    const products = await searchCatalog({ merchantId: id, limit: 100, offset: 0 });
    return { seller, products: products.items };
  });
}

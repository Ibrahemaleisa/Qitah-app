import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('VALIDATION_FAILED', 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const idParam = z.object({ id: z.string().min(1).max(64) });
export const params = <T extends z.ZodRawShape>(req: FastifyRequest, shape: T) => parse(z.object(shape), req.params);
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const halalas = z.number().int().nonnegative().max(100_000_000);
export const cityId = z.enum(['riyadh', 'jeddah', 'makkah', 'madinah', 'dammam', 'khobar']);
export const saudiPhone = z.string().regex(/^\+9665\d{8}$/, 'Saudi mobile in +9665XXXXXXXX format');

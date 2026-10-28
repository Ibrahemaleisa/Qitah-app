import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * HTTP caching for public catalog GETs (served through the CloudFront catalog behaviour, which keys on
 * path + query string, never forwards Authorization, and honours these Cache-Control headers).
 */
export const CACHE = {
  /** Categories, makes/models: change rarely. */
  reference: 'public, max-age=3600, stale-while-revalidate=86400',
  /** Product detail / batch: price and stock move, keep it short. */
  product: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
  /** Home starter pack per vehicle. */
  home: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  /** Ranked search: identical queries from many users share one origin hit for a few seconds. */
  search: 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
  /** Per-client deltas: never stored by shared caches. */
  none: 'no-store',
} as const;

/** Strong validator over the exact response bytes. */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
}

/** True when an If-None-Match header names this ETag (weak or strong comparison: CloudFront may weaken it when compressing). */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (raw.trim() === '*') return true;
  return raw.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}

/**
 * Sends `body` as JSON with Cache-Control + a strong ETag, or `304 Not Modified` (empty body, same
 * validators) when the client already holds this exact representation.
 */
export function sendCached(req: FastifyRequest, reply: FastifyReply, body: unknown, cacheControl: string) {
  const json = JSON.stringify(body);
  const etag = etagOf(json);
  reply.header('cache-control', cacheControl).header('etag', etag);
  if (etagMatches(req.headers['if-none-match'], etag)) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(json);
}

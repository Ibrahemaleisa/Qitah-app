import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { MAX_UPLOAD_BYTES } from '../services/uploads.js';

/** Local-disk upload target used only when no S3 bucket is configured (dev/sandbox). URLs are HMAC-signed and short-lived. */
export async function localUploadRoutes(app: FastifyInstance, deps: Deps) {
  const { uploads } = deps.ctx;
  if (uploads.mode !== 'local') return;
  for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
  }

  app.put('/v1/uploads/local', async (req) => {
    const q = parse(z.object({ key: z.string(), exp: z.string(), sig: z.string(), ct: z.string() }), req.query);
    uploads.verifyLocal('put', q);
    if (req.headers['content-type'] !== q.ct || !Buffer.isBuffer(req.body)) throw new AppError(400, 'BAD_UPLOAD', 'Content type mismatch');
    await uploads.writeLocal(q.key, req.body);
    return { ok: true, key: q.key };
  });

  app.get('/v1/uploads/local', async (req, reply) => {
    const q = parse(z.object({ key: z.string(), exp: z.string(), sig: z.string() }), req.query);
    uploads.verifyLocal('get', q);
    const ext = q.key.split('.').pop();
    reply.type(ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg');
    reply.header('content-disposition', 'inline');
    // The signed, short-lived URL is the capability; photos (part requests / quotes) are embedded as
    // <img> by the app and the portals on other origins, which helmet's default CORP would block.
    if (ext !== 'pdf') reply.header('cross-origin-resource-policy', 'cross-origin');
    return uploads.readLocal(q.key);
  });
}

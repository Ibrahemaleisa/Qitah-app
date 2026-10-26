import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createId } from './uploadIds.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';

import { hmacSha256, safeEqualHex } from '../auth/crypto.js';
import type { Config } from '../config.js';
import { badRequest, forbidden } from '../lib/errors.js';

/**
 * Private document storage (merchant verification documents, label PDFs).
 * AWS: presigned S3 PUT/GET URLs (bucket is private, SSE-KMS). Local/sandbox: signed URLs served by this API from disk.
 */
export const ALLOWED_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

export function createUploads(config: Config) {
  const s3 = config.UPLOADS_BUCKET ? new S3Client({ region: config.AWS_REGION }) : null;
  const localRoot = config.LOCAL_UPLOADS_DIR ?? join(tmpdir(), 'qitah-uploads');
  const secret = config.PAYMENT_WEBHOOK_SECRET + ':uploads';

  const sign = (op: 'put' | 'get', key: string, exp: number, contentType = '') => hmacSha256(secret, `${op}|${key}|${exp}|${contentType}`);
  const localPath = (key: string) => {
    const p = normalize(join(localRoot, key));
    if (!p.startsWith(normalize(localRoot) + '/')) throw forbidden('Invalid key');
    return p;
  };

  return {
    mode: s3 ? ('s3' as const) : ('local' as const),

    async createUpload(input: { prefix: string; contentType: string; sizeBytes: number; fileName: string }) {
      const ext = ALLOWED_TYPES[input.contentType];
      if (!ext) throw badRequest('UNSUPPORTED_TYPE', 'Upload a PDF, JPEG or PNG file');
      if (input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) throw badRequest('TOO_LARGE', 'Files must be 10 MB or smaller');
      const safe = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-60).replace(/\.[^.]*$/, '');
      const key = `${input.prefix}/${createId()}-${safe || 'file'}.${ext}`;
      if (s3) {
        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: config.UPLOADS_BUCKET, Key: key, ContentType: input.contentType, ContentLength: input.sizeBytes }),
          { expiresIn: URL_TTL_SECONDS },
        );
        return { key, uploadUrl, method: 'PUT' as const, headers: { 'content-type': input.contentType }, expiresIn: URL_TTL_SECONDS };
      }
      const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
      const q = new URLSearchParams({ key, exp: String(exp), ct: input.contentType, sig: sign('put', key, exp, input.contentType) });
      return { key, uploadUrl: `${config.PUBLIC_BASE_URL}/v1/uploads/local?${q}`, method: 'PUT' as const, headers: { 'content-type': input.contentType }, expiresIn: URL_TTL_SECONDS };
    },

    async downloadUrl(key: string) {
      if (s3) return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.UPLOADS_BUCKET, Key: key }), { expiresIn: URL_TTL_SECONDS });
      const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
      return `${config.PUBLIC_BASE_URL}/v1/uploads/local?${new URLSearchParams({ key, exp: String(exp), sig: sign('get', key, exp) })}`;
    },

    verifyLocal(op: 'put' | 'get', q: { key: string; exp: string; sig: string; ct?: string }) {
      const exp = Number(q.exp);
      if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqualHex(q.sig, sign(op, q.key, exp, q.ct ?? ''))) throw forbidden('Link expired or invalid');
    },

    async writeLocal(key: string, body: Buffer) {
      const p = localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },

    readLocal: (key: string) => readFile(localPath(key)),
  };
}

export type Uploads = ReturnType<typeof createUploads>;

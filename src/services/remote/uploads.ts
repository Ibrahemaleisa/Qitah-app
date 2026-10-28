import { ApiError } from '@/api/client';
import { meApi } from '@/api/endpoints';

/** Server-accepted image types for return photos (anything else is re-encoded to JPEG by the picker). */
export function uploadContentType(mimeType: string | null | undefined): 'image/jpeg' | 'image/png' {
  return mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
}

/**
 * Uploads one picked photo through the customer's private upload flow:
 * `POST /v1/me/uploads` → short-lived signed PUT URL (S3 or the sandbox API) → returns the key to attach.
 */
export async function uploadReturnPhoto(asset: { uri: string; mimeType?: string | null; fileName?: string | null }): Promise<string> {
  const blob = await (await fetch(asset.uri)).blob();
  const contentType = uploadContentType(asset.mimeType);
  const target = await meApi.createUpload({ purpose: 'return', contentType, sizeBytes: blob.size, fileName: asset.fileName || (contentType === 'image/png' ? 'photo.png' : 'photo.jpg') });
  const res = await fetch(target.uploadUrl, { method: target.method, headers: target.headers, body: blob });
  if (!res.ok) throw new ApiError('UPLOAD_FAILED', `Upload failed (${res.status})`, res.status);
  return target.key;
}

import { NextResponse, type NextRequest } from "next/server";

import { serverConfig } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/http";
import { readSession } from "@/lib/server/session";

/**
 * Upload relay. The browser normally PUTs a document straight to the signed `uploadUrl` returned by
 * POST /v1/merchants/:id/uploads (S3 presigned URL in AWS). When that direct PUT is blocked — the
 * API's local-disk upload target does not allow cross-origin PUT — the browser sends the file here
 * and this server forwards it to the same signed URL. The URL's signature is the authorisation;
 * we only accept targets on the API's own origin (or UPLOAD_RELAY_ORIGINS) and the upload path.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function allowedTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const origins = new Set([new URL(serverConfig.apiBaseUrl).origin, ...(process.env.UPLOAD_RELAY_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!origins.has(url.origin) || url.pathname !== "/v1/uploads/local") return null;
  return url;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {
    originHost = "";
  }
  if (!origin || !host || (originHost !== host && !serverConfig.allowedOrigins.includes(origin))) {
    return errorResponse(403, "CSRF_REJECTED", "Cross-site request refused");
  }
  if (!readSession(req).refreshToken) return errorResponse(401, "UNAUTHENTICATED", "Sign in first");
  const target = allowedTarget(req.headers.get("x-upload-url"));
  if (!target) return errorResponse(400, "BAD_UPLOAD", "Upload target not allowed");
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.has(type) || target.searchParams.get("ct") !== type) return errorResponse(400, "UNSUPPORTED_TYPE", "Upload a PDF, JPEG or PNG file");
  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return errorResponse(413, "TOO_LARGE", "Files must be 10 MB or smaller");

  // Rebuild the URL on the configured API base so a different public hostname still reaches the API.
  const forward = new URL(`${serverConfig.apiBaseUrl}${target.pathname}${target.search}`);
  let res: Response;
  try {
    res = await fetch(forward, { method: "PUT", headers: { "content-type": type }, body, cache: "no-store" });
  } catch {
    return errorResponse(502, "API_UNAVAILABLE", "Upload target unreachable");
  }
  const text = await res.text();
  return new NextResponse(text || "{}", { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

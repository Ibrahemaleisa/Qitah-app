import { NextResponse, type NextRequest } from "next/server";

import { serverConfig } from "./config";

/** Error envelope identical to the API's, so the client handles both the same way. */
export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * CSRF defence for state-changing requests: the browser-supplied Origin must be this app.
 * Session cookies are SameSite=Lax as well, and mutating calls must be JSON, which a
 * cross-site HTML form cannot produce without a CORS preflight.
 */
export function checkCsrf(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const origin = req.headers.get("origin");
  if (!origin) return errorResponse(403, "CSRF_REJECTED", "Missing Origin header");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return errorResponse(403, "CSRF_REJECTED", "Invalid Origin header");
  }
  const host = req.headers.get("host");
  const allowed = serverConfig.allowedOrigins.includes(origin.replace(/\/+$/, ""));
  if (!allowed && (!host || originHost !== host)) return errorResponse(403, "CSRF_REJECTED", "Cross-site request refused");
  const type = req.headers.get("content-type") ?? "";
  const hasBody = req.headers.get("content-length") !== "0" && req.headers.has("content-length");
  if (hasBody && !type.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON");
  }
  return null;
}

/** Reads a JSON body with a size cap. Returns undefined for an empty body. */
export async function readJsonText(req: NextRequest, maxBytes = 2 * 1024 * 1024): Promise<string | undefined | Error> {
  const text = await req.text();
  if (!text) return undefined;
  if (new TextEncoder().encode(text).byteLength > maxBytes) return new Error("TOO_LARGE");
  return text;
}

export async function upstreamJson(path: string, init: { method?: string; body?: unknown; token?: string; userAgent?: string | null } = {}) {
  const res = await fetch(`${serverConfig.apiBaseUrl}${path}`, {
    method: init.method ?? "POST",
    headers: {
      accept: "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.userAgent ? { "user-agent": init.userAgent } : {}),
    },
    body: init.body !== undefined ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body)) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json: json as Record<string, unknown> | undefined };
}

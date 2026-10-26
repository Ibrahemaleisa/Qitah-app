/**
 * Paths the BFF proxy may reach on the API. Everything else (ops, customer, checkout, webhooks,
 * sandbox pages…) returns 404 from the proxy, whatever the caller's role.
 */
const ALLOWLIST: ((path: string) => boolean)[] = [
  (p) => p === "v1/me",
  (p) => p.startsWith("v1/merchants/"),
  (p) => p === "v1/merchant-applications",
  (p) => p.startsWith("v1/catalog/"),
  (p) => p === "v1/events" || p.startsWith("v1/events/"),
];

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Returns the normalised upstream path, or null when the path is malformed or not allowed. */
export function resolveProxyPath(segments: string[] | undefined): string | null {
  if (!segments?.length) return null;
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.length > 200 || !SAFE_SEGMENT.test(s)) return null;
  }
  const path = segments.join("/");
  return ALLOWLIST.some((allow) => allow(path)) ? path : null;
}

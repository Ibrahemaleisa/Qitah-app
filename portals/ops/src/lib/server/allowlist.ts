/**
 * The BFF proxy forwards ONLY these API paths. Everything else (customer, merchant, auth,
 * webhooks, sandbox pages) returns 404 from the proxy, so a stolen portal session cannot be
 * used as a generic API client.
 *
 *   v1/me          GET only
 *   v1/ops/**      any method
 *   v1/catalog/**  GET only
 *   v1/events**    GET only (polling + SSE stream)
 */
const READ = new Set(['GET', 'HEAD']);

export function isAllowedPath(segments: string[], method: string): boolean {
  if (!segments.length || segments.length > 12) return false;
  // Reject traversal and smuggling: each segment must be a plain, non-empty path component.
  if (segments.some((s) => !s || s === '.' || s === '..' || /[/\\?#%\s]/.test(s) || s.length > 128)) return false;
  if (segments[0] !== 'v1') return false;
  const [, head, ...rest] = segments;
  switch (head) {
    case 'me':
      return rest.length === 0 && READ.has(method);
    case 'ops':
      return rest.length > 0;
    case 'catalog':
      return rest.length > 0 && READ.has(method);
    case 'events':
      return READ.has(method);
    default:
      return false;
  }
}

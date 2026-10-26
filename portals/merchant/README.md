# Qitah Merchant Portal (بوابة تجار قطعة)

Arabic-first (RTL) Next.js portal for merchants selling on Qitah. It talks to `services/api` only
through its own server (backend-for-frontend); the browser never holds an API token.

## Run locally

```bash
# 1. API (from services/api) — see services/api for DB setup; RATE_LIMIT_SCALE helps when testing
#    CORS_ORIGINS is not needed by the portal (uploads fall back to the /api/upload relay).
# 2. Portal
cd portals/merchant
npm ci
cp .env.example .env.local        # API_BASE_URL=http://127.0.0.1:4101
npm run dev -- -p 3101            # or: npm run build && npm start -- -p 3101
```

Sandbox logins (password `Qitah-Sandbox-2026!`): `owner@riyadh-center.qitah.test` (OWNER),
`staff@riyadh-center.qitah.test` (STAFF), `owner@new-applicant.qitah.test` (store under review).

## Architecture

- `src/app/api/auth/{login,register,logout}` — exchange credentials for API tokens and keep them in
  httpOnly, SameSite=Lax cookies (`Secure` in production). `AUTH_MODE=cognito` signs in with Amazon
  Cognito `USER_PASSWORD_AUTH` and stores the ID token (`src/lib/server/cognito.ts`).
- `src/app/api/proxy/[...path]` — forwards to `API_BASE_URL` with the Bearer token; refreshes once on
  401 (refresh calls are de-duplicated per instance because refresh tokens rotate); only
  `v1/me`, `v1/merchants/**`, `v1/merchant-applications`, `v1/catalog/**`, `v1/events**` are reachable
  (`src/lib/server/allowlist.ts`); streams SSE unbuffered.
- CSRF: every mutating BFF call must carry an `Origin` matching the host (or `ALLOWED_ORIGINS`) and a
  JSON body.
- `src/proxy.ts` — redirects signed-out visitors to `/login`.
- `src/app/api/upload` — relay for verification documents when the direct PUT to the signed upload
  URL is blocked by CORS (the API's local upload target); only forwards to the API's origin.
- UI: client components fetching through the proxy with a small hook (`src/lib/useApi.ts`). One
  `EventSource` per store (`src/components/portal/Realtime.tsx`) re-broadcasts events so views
  refetch; it falls back to polling `/v1/events` every 30 s.
- Roles (`src/lib/permissions.ts`): STAFF = orders + stock; MANAGER = + catalog, locations, returns,
  settlements, activity; OWNER = + staff, verification. The API enforces the same rules.
- Money is integer halalas; typed SAR is parsed as a string (`parseSarToHalalas`), never with floats.

## Checks

```bash
npm run lint && npx tsc --noEmit && npm run build
node e2e/smoke.mjs     # needs the API on :4101 and the portal on :3101 (PORTAL_URL / API_URL to override)
```

The smoke test registers a store, approves it via the ops API, adds a location, creates a product and
an offer, places a paid order as a customer, fulfils it through to a sandbox label, and checks the
proxy allowlist, CSRF, cookie flags and STAFF permissions. Screenshots land in `e2e/shots/` (ignored).

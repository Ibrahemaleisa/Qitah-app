# Qitah Ops Portal — بوابة العمليات وبرج التحكم

Internal, Arabic-first (RTL) web app for Qitah staff (operations agents, ops admins, finance): merchant
onboarding, order tracing, the virtual-warehouse **shipping control tower**, returns, finance and audit.
It runs against the real backend in `services/api` (contract: `services/api/src/routes/ops.ts`).

Next.js 16 (App Router, TypeScript strict, Cache Components), plain CSS with logical properties, no UI
libraries. Runtime dependencies: `next`, `react`, `react-dom`.

## Security architecture

```
browser ──(same origin, httpOnly cookies)──▶ Next.js BFF ──(Bearer token)──▶ API_BASE_URL (services/api)
```

- **Tokens never reach the browser.** `POST /api/auth/login` exchanges email + password for tokens and stores
  them in `httpOnly`, `SameSite=Strict` cookies (`Secure` when `NODE_ENV=production` or `COOKIE_SECURE=true`).
  `POST /api/auth/logout` revokes the refresh token at the API and clears the cookies.
- **`/api/proxy/[...path]`** forwards to `API_BASE_URL` (server-only env var) with the Bearer token, refreshes
  once on 401 (single-flight, because the API rotates refresh tokens), and streams Server-Sent Events through.
- **Allowlist**: only `v1/me` (GET), `v1/ops/**`, `v1/catalog/**` (GET) and `v1/events**` (GET) are forwarded.
  Everything else — customer, merchant, auth, webhook and sandbox routes — returns 404.
- **CSRF**: mutating requests must carry this portal's `Origin` (or `Sec-Fetch-Site: same-origin`); `APP_ORIGIN`
  pins it explicitly. Login is protected the same way.
- **Every page requires a session**: `src/proxy.ts` (Next 16's renamed *middleware*) redirects visitors without a
  session cookie to `/login`. The app shell then calls `/v1/me`; users without a platform role (e.g. merchants)
  get a no-access screen. The API remains the authority on roles for every call.
- **Cognito** (`AUTH_MODE=cognito`): server-side `InitiateAuth` (`USER_PASSWORD_AUTH`, plus `REFRESH_TOKEN_AUTH`)
  with `COGNITO_REGION` / `COGNITO_CLIENT_ID` (and optional `COGNITO_CLIENT_SECRET` → `SECRET_HASH`). The Cognito
  **ID token** is stored as the access token. *Not exercised here — no user pool is available in this sandbox.*
  MFA / NEW_PASSWORD_REQUIRED challenges are not supported by the login form yet.
- Security headers (`X-Frame-Options: DENY`, `nosniff`, `noindex`, …) in `next.config.ts`.

Never deploy this portal without auth: there is no anonymous mode, and `AUTH_MODE=local` is refused by the API in
production.

## Pages

| Route | What it does | Roles |
| --- | --- | --- |
| `/login` | Email + password (works without JS too) | — |
| `/` | Summary cards linking to the right queue, live SSE activity feed, ops notifications | all |
| `/tower` | **Shipments board**: lanes PENDING → LABEL_CREATED → PICKUP_SCHEDULED → with carrier → exceptions → delivered; OUTBOUND / RETURN filter; per-card next action; bulk "labels for all ready" | actions: OPS_AGENT |
| `/tower/queue` | **Fulfilment queue**: suborders by stage, live SLA countdown (amber < 60 min, red when breached), origin pickup location, items, act on the merchant's behalf | actions: OPS_AGENT |
| `/tower/shipments/[id]` | Shipment detail: origin / destination, service, quoted cost, weight, pickup window, events; label, pickup (Riyadh time-window picker), manual event, sandbox carrier simulation — only transitions valid from the current status (`src/lib/states.ts` mirrors `services/api/src/domain/states.ts`) | actions: OPS_AGENT |
| `/exceptions` | Failed pickups, delivery failures, carrier exceptions, delayed pickups (window passed → record failure + rebook in one step), merchant SLA breaches, failed refunds, flagged payment webhooks | all |
| `/orders` | Search by order number or phone, status filter | all |
| `/orders/[id]` | **Order trace**: header + totals, customer/address, suborders with SLA and on-behalf actions, items, shipping groups → shipments → tracking timeline, payments + raw webhook log, refunds, returns, ledger grouped by posting (balanced check), reconciliation (green «مطابق» or issues), chronological audit trail; partial / goodwill refund dialog (idempotency key per opening) | refund: FINANCE |
| `/merchants`, `/merchants/[id]` | List with status filter + search; detail with business info, CR/VAT, verification documents (signed "view document" links) and history, members, pickup locations, order stats, ledger balance; approve (optional commission bps) / reject / suspend / reinstate | decisions: OPS_ADMIN |
| `/returns` | By status; approve (creates a RETURN shipment for the tower) / reject (reason) / mark received / inspect (accept, restock, optional partial refund in SAR) | actions: OPS_AGENT |
| `/finance` | Settlement eligibility per merchant, generate (sandbox: simulated `asOf` to elapse the return window), approve, mark paid with payout reference (bank transfers happen outside Qitah), payment webhook log, "settle sandbox refunds" | FINANCE |
| `/audit` | Audit log with entity type / id / merchant filters | all |
| `/staff` | Create ops users / grant roles | OPS_ADMIN |

OPS_ADMIN implies every role (same rule as the API). Sandbox-only actions are marked «محاكاة — بيئة تجريبية».

**Realtime**: one fetch-based SSE connection per tab (`/v1/events/stream?scope=ops` via the BFF) refreshes the
board, queue, trace and lists (debounced) and raises toasts for shipment exceptions; while disconnected it polls
every 20 s and reconnects with backoff.

**Money** is integer halalas end-to-end; typed SAR amounts are parsed with string math (`src/lib/money.ts`,
Arabic-Indic digits accepted). Dates are Gregorian, Western digits, Riyadh time.

**Keyboard**: `/` focuses order search; `g` then `t` tower, `o` orders, `m` merchants, `e` exceptions, `r` returns,
`f` finance, `a` audit, `h` home.

## Run locally

```bash
# 1. API (see services/api/README.md) on :4102, e.g.
createdb -h 127.0.0.1 -U qitah qitah_ops
cd services/api && npm ci
export DATABASE_URL=postgresql://qitah@127.0.0.1:5432/qitah_ops JWT_SECRET=dev-only-change-me-at-least-32-characters-long \
  PAYMENT_WEBHOOK_SECRET=dev-sandbox-webhook-secret CARRIER_WEBHOOK_SECRET=dev-sandbox-carrier-secret \
  PUBLIC_BASE_URL=http://127.0.0.1:4102 PORT=4102 RATE_LIMIT_SCALE=1000
npx prisma migrate deploy && npx tsx prisma/seed.ts --force && npx tsx src/main.ts

# 2. Portal on :3102
cd portals/ops && npm ci
cp .env.example .env.local          # API_BASE_URL=http://127.0.0.1:4102, AUTH_MODE=local
npm run dev                         # or: npm run build && npm start
```

Seeded logins (password `Qitah-Sandbox-2026!`): `ops.admin@qitah.test`, `ops.agent@qitah.test`, `finance@qitah.test`;
merchant owners such as `owner@riyadh-center.qitah.test` get the no-access screen.

`npm run demo:orders` scripts customers and merchants against the API to create orders in every state
(new, accepted, ready, labelled, scheduled, in transit, pickup/delivery failures, returns).

## Checks

```bash
npm run lint && npx tsc --noEmit && npm run build
node e2e/smoke.mjs     # needs the API (freshly seeded) + portal running; screenshots → e2e/shots/ (gitignored)
node e2e/tour.mjs      # optional: exercises the remaining workflows per role and at tablet/phone widths
```

The smoke test logs in as ops admin, approves «نجد لقطع الغيار», creates a paid order that the merchant marks
ready (via the API) while the board is open (it must appear without a reload), creates the label, schedules
pickup, simulates PICKED_UP → IN_TRANSIT → DELIVERED, then checks the order trace (DELIVERED, ledger entries,
reconciled), the proxy allowlist, CSRF rejection, cookie flags, the merchant no-access screen and the login redirect.

## Known limitations

- No `GET /v1/ops/staff` endpoint exists, so `/staff` shows grants from the audit log instead of a staff list.
- The refresh single-flight is per process; with several portal instances, use sticky sessions (or accept an
  occasional re-login when two instances refresh the same token concurrently).
- Logout revokes the refresh token; an already-issued access JWT stays valid until it expires (≤ 1 h), as the API
  has no access-token revocation.
- `next/font` downloads IBM Plex Sans Arabic at build time; builds need access to Google Fonts (the CSS falls back
  to the system font stack at runtime).

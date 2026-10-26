# Qitah Marketplace API (`services/api`)

Fastify 5 + Prisma 6 + PostgreSQL 16 modular monolith. It is the single source of truth for the customer app,
the merchant portal and the Qitah operations portal / shipping control tower.

## Run locally
```bash
cp .env.example .env              # sandbox defaults
npm ci
npx prisma migrate deploy         # apply migrations
npm run db:seed -- --force        # sandbox data (refused when NODE_ENV=production)
npm run dev                       # API on :4000
npm run dev:worker                # background jobs (expiry, SLA, pickup delays, refunds, outbox→SQS)
```
Needs PostgreSQL 16 (`docker compose up postgres` from the repo root, or a local server).

Seeded logins (sandbox only) share the password `Qitah-Sandbox-2026!` (override with `SEED_PASSWORD`):
| Who | Login |
| --- | --- |
| Qitah ops admin / agent / finance | `ops.admin@qitah.test`, `ops.agent@qitah.test`, `finance@qitah.test` |
| Merchant owner / staff | `owner@riyadh-center.qitah.test`, `staff@riyadh-center.qitah.test` (also eastern, brake-house, salvage, elite-oils, quickfix) |
| Merchant awaiting approval | `owner@new-applicant.qitah.test` |
| Customer | phone `+966500000001` via OTP (the sandbox code is returned by `/v1/auth/otp/request` outside production) |

## Tests
`npm test` runs unit tests + the full lifecycle E2E + failure scenarios against `TEST_DATABASE_URL`
(default `postgresql://qitah@127.0.0.1:5432/qitah_test`; the database name **must** end in `_test`; its schema is recreated).

## Modules
| Area | Code |
| --- | --- |
| Schema & constraints | `prisma/schema.prisma`, `prisma/migrations/*` (CHECK constraints, append-only ledger trigger) |
| Auth & RBAC | `src/auth/*` — local JWT (sandbox OTP, staff passwords) or Amazon Cognito JWT; merchant-scoped roles OWNER/MANAGER/STAFF; platform roles OPS_AGENT/OPS_ADMIN/FINANCE |
| Catalog & fitment | `src/services/catalog.ts`, `routes/catalog.ts` |
| Inventory | `src/services/inventory.ts` — atomic conditional reservations, commit on verified payment, adjustments ledger |
| Smart cart | `src/domain/optimizer.ts` — deterministic landed-cost optimisation over offers × shipping groups × carrier services |
| Checkout & orders | `src/services/checkout.ts`, `orders.ts` — server-priced plans, idempotent checkout, merchant suborders, fulfilment groups |
| Payments | `src/services/payments.ts`, `providers/payment/*` — provider-independent; sandbox hosted page + HMAC webhooks; dedupe on provider event id |
| Fulfilment & shipping | `src/services/fulfillment.ts`, `shipping.ts`, `providers/carrier/*` — merchant actions, labels, pickups, tracking events |
| Returns & refunds | `src/services/returns.ts` — return cases, reverse shipments, inspection, partial refunds |
| Finance | `src/services/ledger.ts`, `finance.ts` — double-entry ledger, settlements/payouts, per-order reconciliation |
| Realtime & jobs | `routes/events.ts` (polling + SSE over the outbox), `src/jobs.ts`, `src/worker.ts` |

## API surface (all JSON; money in halalas)
- Public: `GET /health`, `GET /ready`, `GET /v1/catalog/{reference,snapshot,products,products/:id,offers,sellers/:id}`, `POST /v1/merchant-applications`
- Auth: `POST /v1/auth/{otp/request,otp/verify,login,refresh,logout}`, `GET|PATCH /v1/me`
- Customer: `/v1/me/{vehicles,addresses,cart,notifications}`, `POST /v1/checkout/plan`, `POST /v1/checkout`, `GET /v1/orders[/:id]`, `POST /v1/orders/:id/{payment,cancel,returns}`
- Merchant (`/v1/merchants/:merchantId/...`): profile, verification, dashboard, locations, staff, catalog/products, offers (+stock, adjustments, CSV import), orders (+accept/pack/ready/reject), returns (+approve/reject/receive/inspect), settlements, notifications, activity
- Ops (`/v1/ops/...`): summary, merchants (+approve/reject/suspend/reinstate), orders (+full trace, reconcile, refunds), fulfillment/queue, merchant-orders actions, shipments (+label/pickup/events/sandbox-event), exceptions, returns, settlements (+generate/approve/paid), payments/events, audit, notifications, staff
- Webhooks: `POST /v1/webhooks/payments/:provider`, `POST /v1/webhooks/carriers/:carrier` (signature-verified)
- Realtime: `GET /v1/events?scope=customer|merchant|ops&after=` and `GET /v1/events/stream` (SSE)
- Sandbox only: `/sandbox/pay/:id` (hosted test payment page), `/sandbox/labels/:shipmentId`

## Sandbox vs production
The payment and carrier providers are **sandbox adapters**: no money moves, and tracking numbers (`SBX…`) are fake and
labelled as such. Production refuses to boot with sandbox providers or `AUTH_MODE=local`
(`src/config.ts`). Real payment-provider and carrier adapters implement `PaymentProvider` / `CarrierAdapter`.

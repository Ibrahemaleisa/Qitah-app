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
| Search | `src/search/lexicon.ts` (colloquial Arabic/English part dictionary + query/vehicle parser, byte-identical copy in the app at `src/lib/search/lexicon.ts`), `src/services/search.ts` (ranked SQL, pg_trgm) |
| Inventory | `src/services/inventory.ts` — atomic conditional reservations, commit on verified payment, adjustments ledger |
| Smart cart | `src/domain/optimizer.ts` — deterministic landed-cost optimisation over offers × shipping groups × carrier services |
| Checkout & orders | `src/services/checkout.ts`, `orders.ts` — server-priced plans, idempotent checkout, merchant suborders, fulfilment groups |
| Payments | `src/services/payments.ts`, `providers/payment/*` — provider-independent; sandbox hosted page + HMAC webhooks; dedupe on provider event id |
| Fulfilment & shipping | `src/services/fulfillment.ts`, `shipping.ts`, `providers/carrier/*` — merchant actions, labels, pickups, tracking events |
| Returns & refunds | `src/services/returns.ts` — return cases, reverse shipments, inspection, partial refunds |
| Finance | `src/services/ledger.ts`, `finance.ts` — double-entry ledger, settlements/payouts, per-order reconciliation |
| Realtime & jobs | `routes/events.ts` (polling + SSE over the outbox), `src/jobs.ts`, `src/worker.ts` |
| Part requests (RFQ) | `src/services/partRequests.ts`, `routes/partRequests.ts` — customer requests (photos via signed URLs), one quote per merchant, accepting creates a PRIVATE offer (buyer-only, expires with the quote) that reuses checkout → payments → fulfilment → returns → settlements; DRAFT product for free-text quotes; expiry job; ops metrics (share answered within 15 min) |

## API surface (all JSON; money in halalas)
- Public: `GET /health`, `GET /ready`, `GET /v1/catalog/{reference,snapshot,search,products,products/:id,offers,sellers/:id}`, `POST /v1/merchant-applications`

### `GET /v1/catalog/search`
Understands colloquial part names (كفرات، قربة، هوبات، بوجيهات…) and vehicles typed in the query ("فلتر زيت كامري 2022").

| Param | Meaning |
| --- | --- |
| `q` | Free text, part number or both (≤100 chars). |
| `modelId`, `year`, `engine` — or `vehicle=modelId:year:engine` | The customer's selected vehicle. A model/year typed in `q` overrides it (and drops the engine unless model and year match). |
| `fitsOnly` | `true` → only parts whose fitment data covers the vehicle (catalog, seller-reported or universal-by-spec). Others are counted in `counts.hidden` (for a "show all" toggle); part-number hits stay visible. |
| `categoryId`, `origin=oem,aftermarket`, `condition=new,used,refurbished`, `inStock` | Filters. |
| `sort` | `relevance` (default), `priceAsc`, `priceDesc`, `fastest`. |
| `cursor`, `limit` (1–50, default 20) | Keyset paging: pass back `nextCursor`. |

Response: `{ items, nextCursor, total, counts: { fits, other, hidden }, interpretation, didYouMean, fallback, suggestions: { categoryIds } }` (`hidden` = not-confirmed parts left out by `fitsOnly`; a typed part number is never hidden).
- `items[]` — the same product shape as `GET /v1/catalog/products/:id` → `product`, plus `match: { fit, group: 'fits' | 'other', partNumber }`. `fit` is `catalogMatch | sellerReported | bySpecification | noData | noVehicle`, or `listedForModel | listedForMake` when the vehicle is only a model (no year) or a make — never "fits your car" without a year.
- `interpretation` — `{ concepts: [{ id, label, categoryId, carried, term }], conceptGroups, freeTokens, partNumber, partNumbers, year, queryVehicle, vehicle: { source, makeId, modelId, year, engine, scope, yearOutOfRange, label }, withoutVehicle, unsupported: [{ id, label }] }`. `unsupported` lists parts Qitah doesn't carry yet (tires, clutch, transmission, A/C compressor, starter) so the app can offer "request this part"; `withoutVehicle` is the query minus the vehicle words (what removing the vehicle chip searches).
- `fallback` — `null`, or `{ mode: 'corrected', query }` (one-edit spelling fix from the lexicon), `{ mode: 'relaxed' }` (concepts kept, extra words dropped), `{ mode: 'similar' }` (pg_trgm word similarity).
- Ranking: exact MPN > exact OEM reference > part-number prefix > contained; then fits before not-confirmed (when a vehicle is known); concept matches; trigram similarity; fitment tier catalog > seller > by-spec.

`GET /v1/catalog/products` keeps its `{ total, items }` + `limit/offset` contract and delegates to the same search.
After changing `src/search/lexicon.ts`, copy it to the app and run `npm run db:backfill-search` to rebuild `Product.searchText`.
- Auth: `POST /v1/auth/{otp/request,otp/verify,login,refresh,logout}`, `GET|PATCH /v1/me`
- Customer: `/v1/me/{vehicles,addresses,cart,notifications}`, `POST /v1/checkout/plan`, `POST /v1/checkout`, `GET /v1/orders[/:id]`, `POST /v1/orders/:id/{payment,cancel,returns}`
- Merchant (`/v1/merchants/:merchantId/...`): profile, verification, dashboard, locations, staff, catalog/products, offers (+stock, adjustments, CSV import), orders (+accept/pack/ready/reject), returns (+approve/reject/receive/inspect), settlements, notifications, activity
- Ops (`/v1/ops/...`): summary, merchants (+approve/reject/suspend/reinstate), orders (+full trace, reconcile, refunds), fulfillment/queue, merchant-orders actions, shipments (+label/pickup/events/sandbox-event), exceptions, returns, settlements (+generate/approve/paid), payments/events, audit, notifications, staff
- Part requests: customer `POST /v1/me/uploads` (purpose `part-request`), `GET|POST /v1/me/part-requests`, `GET /v1/me/part-requests/:id`, `POST /v1/me/part-requests/:id/{cancel,quotes/:quoteId/accept}`, `GET /v1/me/private-offers`; merchant `GET /v1/merchants/:id/part-requests[/:requestId]`, `POST|PATCH /v1/merchants/:id/part-requests/:requestId/quote`, `POST …/quote/withdraw`, `GET /v1/merchants/:id/part-quotes` (uploads purpose `part-quote`); ops `GET /v1/ops/part-requests[/:id]`.
  Matching rule (v1): a merchant sees OPEN/QUOTED, unexpired requests whose delivery city is one of its operating cities (store city or an active pickup location) **or** whose vehicle make is fitted by one of its active public offers. Merchants never see the customer's identity or other merchants' quotes.
- Webhooks: `POST /v1/webhooks/payments/:provider`, `POST /v1/webhooks/carriers/:carrier` (signature-verified)
- Realtime: `GET /v1/events?scope=customer|merchant|ops&after=` and `GET /v1/events/stream` (SSE)
- Sandbox only: `/sandbox/pay/:id` (hosted test payment page), `/sandbox/labels/:shipmentId`

## Sandbox vs production
The payment and carrier providers are **sandbox adapters**: no money moves, and tracking numbers (`SBX…`) are fake and
labelled as such. Production refuses to boot with sandbox providers or `AUTH_MODE=local`
(`src/config.ts`). Real payment-provider and carrier adapters implement `PaymentProvider` / `CarrierAdapter`.

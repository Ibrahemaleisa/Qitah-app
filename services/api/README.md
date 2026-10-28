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
| Workshops (B2B) | `src/services/organizations.ts`, `workshopQuotes.ts`, `routes/organizations.ts`, `routes/workshopQuotePublic.ts` — see "Workshop accounts" below |

| Merchant economics | `src/domain/{commission,settlement,freshness,scorecard}.ts` (pure rules), `src/services/{commission,freshness,scorecard}.ts`, `finance.ts` — see § Merchant economics |
| Part requests (RFQ) | `src/services/partRequests.ts`, `routes/partRequests.ts` — customer requests (photos via signed URLs), one quote per merchant, accepting creates a PRIVATE offer (buyer-only, expires with the quote) that reuses checkout → payments → fulfilment → returns → settlements; DRAFT product for free-text quotes; expiry job; ops metrics (share answered within 15 min) |

## API surface (all JSON; money in halalas)
- Public: `GET /health`, `GET /ready`, `GET /v1/catalog/{reference,home,changes,search,products,products/:id,offers,sellers/:id,snapshot (deprecated)}`, `POST /v1/merchant-applications`

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
After changing `src/search/lexicon.ts`, copy it to the app and run `npm run db:backfill-search` to rebuild `Product.searchText` (it also refreshes the listings' copy).

### Catalog at scale (on-demand hydration, read model, CDN)
| Endpoint | Purpose | Cache-Control |
| --- | --- | --- |
| `GET /v1/catalog/reference` | categories + makes/models; strong `ETag`, `304` on `If-None-Match` | `public, max-age=3600, stale-while-revalidate=86400` |
| `GET /v1/catalog/products/:id` | `{ product, sellers }`; `ETag`/304 | `public, max-age=30, s-maxage=60, stale-while-revalidate=300` |
| `GET /v1/catalog/products?ids=a,b&offerIds=x` | batch (≤100) for favorites / recent / cart → `{ products, sellers, missing }`; `ETag`/304 | same as detail |
| `GET /v1/catalog/home?modelId=&year=&engine=` | starter pack ≤24: `recommended` (catalog-verified fit, in stock, ≤3 per category) + `featured` (top per category; universal only when a vehicle is given) | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` |
| `GET /v1/catalog/changes?since=<iso>&ids=` | deltas for ≤100 cached ids: changed products in full, `removed`, `serverTime` (next `since`) | `no-store` |
| `GET /v1/catalog/search` | as above | `public, max-age=15, s-maxage=30, stale-while-revalidate=60` |
| `GET /v1/catalog/snapshot` | **deprecated**, capped at 2,000 products (`truncated`), headers `Deprecation: true`, `Sunset`, `Link: </v1/catalog/home>; rel="successor-version"` | `public, max-age=30` |

Offers in every product payload keep the detail ordering (in stock, fresh, price, quality score). CloudFront caches `/v1/catalog/*` by path + query string (+ `Origin`), never with `Authorization`, and only what these headers allow (default TTL 0).

**`ProductListing` read model** (`*_catalog_read_model`, `services/listings.ts`): one row per product derived only from offers passing `publicOfferWhere` (visibility PUBLIC, ACTIVE, approved merchant, active location, confirmed within `FRESHNESS_HIDE_DAYS`): price/stock aggregates, conditions, merchant ids, origin cities, per-offer summary, exploded fitment keys (GIN), a copy of `searchText` (GIN trigram) and `nextChangeAt` (next freshness boundary). Search scans only this table. It is refreshed in the same transaction by every offer / stock / reservation / commit / release / restock / confirmation / merchant-status / location write (`refreshListing(s)`, rows locked before reading so concurrent writers cannot leave a stale aggregate); the worker re-derives listings whose `nextChangeAt` passed plus a rolling safety-net slice. After deploying: `npm run db:backfill-listings` (idempotent; the migration already populates rows with the default freshness cutoff).

**Load test** (`scripts/loadtest/`): `npm run loadtest:generate -- --products=200000` (synthetic Arabic catalog, scratch DBs only, nothing committed) then `npm run loadtest:bench` (p50/p95/p99 + EXPLAIN plans).
- Auth: `POST /v1/auth/{otp/request,otp/verify,login,refresh,logout}`, `GET|PATCH /v1/me`
- Customer: `/v1/me/{vehicles,addresses,cart,notifications}`, `POST /v1/checkout/plan`, `POST /v1/checkout`, `GET /v1/orders[/:id]`, `POST /v1/orders/:id/{payment,cancel,returns}`
- Merchant (`/v1/merchants/:merchantId/...`): profile, verification, dashboard, locations, staff, catalog/products, offers (+stock, adjustments, CSV import), orders (+accept/pack/ready/reject), returns (+approve/reject/receive/inspect), settlements, notifications, activity
- Ops (`/v1/ops/...`): summary, merchants (+approve/reject/suspend/reinstate), orders (+full trace, reconcile, refunds), fulfillment/queue, merchant-orders actions, shipments (+label/pickup/events/sandbox-event), exceptions, returns, settlements (+generate/approve/paid), payments/events, audit, notifications, staff
- Part requests: customer `POST /v1/me/uploads` (purpose `part-request`), `GET|POST /v1/me/part-requests`, `GET /v1/me/part-requests/:id`, `POST /v1/me/part-requests/:id/{cancel,quotes/:quoteId/accept}`, `GET /v1/me/private-offers`; merchant `GET /v1/merchants/:id/part-requests[/:requestId]`, `POST|PATCH /v1/merchants/:id/part-requests/:requestId/quote`, `POST …/quote/withdraw`, `GET /v1/merchants/:id/part-quotes` (uploads purpose `part-quote`); ops `GET /v1/ops/part-requests[/:id]`.
  Matching rule (v1): a merchant sees OPEN/QUOTED, unexpired requests whose delivery city is one of its operating cities (store city or an active pickup location) **or** whose vehicle make is fitted by one of its active public offers. Merchants never see the customer's identity or other merchants' quotes.
- Workshops (members, guard `requireOrg(req, orgId, minRole)` with OWNER > BUYER > TECHNICIAN): `POST /v1/orgs` (apply; caller becomes OWNER), `GET /v1/me/orgs` (links pending phone invites), `GET /v1/orgs/:id`, `GET|POST /v1/orgs/:id/members`, `DELETE /v1/orgs/:id/members/:memberId`, `GET /v1/orgs/:id/statement` (BUYER+), `GET|POST /v1/orgs/:id/quotes`, `GET /v1/orgs/:id/quotes/:quoteId`, `POST …/quotes/:quoteId/convert`; `GET /v1/orders?orgId=` (org orders; without it only personal orders); checkout accepts `buyerOrgId`, `workOrderRef` and `paymentMethod: NET_TERMS`. Public quote page: `GET|POST /q/:token`. Ops: `GET /v1/ops/organizations[/:id]`, `POST /v1/ops/organizations/:id/{approve,reject,suspend,reinstate}`, `PUT /v1/ops/organizations/:id/credit`, `POST /v1/ops/organizations/:id/repayments`, `GET /v1/ops/receivables/overdue`, `GET /v1/ops/workshop-leads`.
- Webhooks: `POST /v1/webhooks/payments/:provider`, `POST /v1/webhooks/carriers/:carrier` (signature-verified)
- Realtime: `GET /v1/events?scope=customer|merchant|ops&after=` and `GET /v1/events/stream` (SSE)
- Sandbox only: `/sandbox/pay/:id` (hosted test payment page), `/sandbox/labels/:shipmentId`

## Workshop accounts ("قطعة للورش")
- **Organisation** (WORKSHOP | FLEET): any signed-in user applies with a 10-digit CR number and becomes OWNER; ops approves/rejects/suspends. The OWNER invites BUYER/TECHNICIAN members by phone (`OrganizationMember.status = INVITED`); the invite is linked when that phone signs in with OTP (or on the first Cognito sign-in, or on `GET /v1/me/orgs`).
- **Ordering**: only an ACTIVE BUYER/OWNER of an APPROVED org may send `buyerOrgId` (checked from the DB inside the checkout transaction). `Order.buyerOrgId` marks the B2B channel (commission rules derive it later; see the TODO in `checkout.ts`).
- **NET_TERMS** (Qitah's INTERNAL sandbox credit line, `OrganizationCredit.provider = 'qitah-internal-sandbox'`; no financing partner): checkout locks the org's credit row `FOR UPDATE`, requires `outstanding + total ≤ limit`, and in the same transaction creates a `credit` Payment CAPTURED by the server and confirms the order (`creditDueAt = paidAt + termsDays`). Ledger: debit `CUSTOMER_RECEIVABLE` (instead of `CUSTOMER_CLEARING`); merchant payable/commission/shipping are identical to a card order, so **merchants are paid by Qitah regardless**. Outstanding = the org's `CUSTOMER_RECEIVABLE` balance. Card payments for org orders still use the payment provider.
- **Repayments** (`POST /v1/ops/organizations/:id/repayments`, FINANCE, idempotent on `(org, idempotencyKey)`): allocated oldest-due first; one `CREDIT_REPAYMENT` posting per order: debit `CUSTOMER_CLEARING`, credit `CUSTOMER_RECEIVABLE`.
- **Refunds on credit orders** never call the provider: `createRefund` settles them in the same transaction and credits `CUSTOMER_RECEIVABLE`. Only the part of a refund that exceeds the order's remaining receivable (i.e. after the workshop already repaid it) is booked to `CUSTOMER_CLEARING` as cash owed back, and ops is notified to pay it out.
- `reconcileOrder` for credit orders checks `receivable + clearing = captured − refunded`, `receivable ≥ 0` and `clearing ≤ repayments allocated to the order`. `CREDIT_EXPOSURE` was not added: exposure is the receivable balance and the limit is not a ledger fact.
- **Workshop → customer quote** (`WorkshopQuote`): parts at the Qitah price + labour + the workshop's margin (`markupHalalas`), shown **transparently** to the customer as separate lines ("أجرة اليد", "رسوم الورشة"). The share link (`/q/:token`, 72 h, only the token's SHA-256 is stored) is an escaped, noindex, no-store, no-referrer Arabic page showing only what the workshop typed (never the customer's phone). Approve → the quote is converted into a workshop order for the quote's creator (NET_TERMS when the credit covers it, else card), with `Order.workshopQuoteId` for attribution; on failure it stays APPROVED with `convertError` and can be retried.

## Merchant economics
Committee blockers: late payouts, one flat commission, stock accuracy, unaccounted payment fees.

**Commission per order line** (`domain/commission.ts` → `resolveCommissionBps`). A `CommissionRule` has optional
`merchantId`, `categoryId`, `origin` (OEM/AFTERMARKET), `condition`, a `channel` (B2C/B2B/ANY), `bps`, `priority`,
`active`, `validFrom/validTo`. Among the active, in-window rules matching a line the most specific wins
(weights: merchant 16, category 8, origin 4, condition 2, channel 1; ties → priority, then latest `validFrom`).
`Merchant.commissionBps` (nullable) is a negotiated merchant-wide **B2C** rate. It ranks like a merchant-only rule, so it
overrides the platform tiers but loses to explicit rules for that merchant. Otherwise `COMMISSION_DEFAULT_BPS` (1000) applies.
The migration seeds these defaults: aftermarket B2C new 1000, used/refurbished 1200; OEM B2C 700; accessories 1300; B2B 500.
It also turns the legacy column default of 1000 into NULL (tiers). Each `OrderItem` stores `commissionBps/commissionHalalas/commissionRuleId`.
`MerchantOrder.commissionHalalas` = Σ lines and `MerchantOrder.commissionBps` = the blended display rate.
Refunds (returns, goodwill, rejection) reverse commission per line at that line's rate (`splitRefundByLine`, capped at what
the line still holds); the split is recorded in `Refund.allocation[].lines`. `orderChannel(order)` is the single place
that will map workshop orders (`buyerOrgId`) to B2B. Today it returns B2C.

**Payment fees** — at capture: debit `PAYMENT_FEES`, credit `CUSTOMER_CLEARING` (the PSP nets its fee from what it remits).
Configurable per method: `PAYMENT_FEE_BPS_{MADA,CARD,APPLE_PAY,STC_PAY}` (80/200/200/150). In sandbox, `Payment.feeEstimated` is true.
Fees are platform cost: they are never refunded and never change merchant or customer amounts.
`reconcileOrder` expects `CUSTOMER_CLEARING = captured − refunded − fees` and `PAYMENT_FEES = Σ Payment.feeHalalas`.
It also checks that Σ line commission = suborder commission.
Contribution margin per order is `commission (net) + shipping margin − payment fees − guarantee expense`.
Shipping margin is shipping paid, net of shipping refunds, minus the cost of outbound labels; it is computed because shipping is pass-through in the ledger.
Endpoint: `GET /v1/ops/finance/margins`.

**Automatic settlement** — `economicsJobs` runs from the worker every 10 minutes and from `POST /v1/ops/settlements/run`.
It does four things, in order: release reserves, draft settlements, send stale-offer reminders, and refresh the cached quality score.
- **Drafts.** It creates one DRAFT per merchant per period: `WEEKLY` on `SETTLEMENT_WEEKDAY` (Riyadh, default Sunday) or `DAILY`. The period's `JobRunMark` is inserted in the same transaction, so drafting is idempotent across workers.
- **Early payout.** Merchants with `DAILY` and `trustedForEarlyPayout` can settle a delivered order immediately. The draft withholds `SETTLEMENT_RESERVE_BPS` (10%) of the order's payable through a `RESERVE_HOLD` posting (MERCHANT_PAYABLE → `MERCHANT_RESERVE`).
- **Reserve release.** Once the return window has closed and no return or refund is open, `RESERVE_RELEASE` moves the reserve back. A `RESERVE_RELEASE` settlement line then pays `reserve − refunds booked after the early payout`; this can be negative and offsets other lines. Only one hold and one release are posted per merchant order.
- **Approval.** Approval and mark-paid stay manual (FINANCE).

**Offer freshness** (`domain/freshness.ts`). `Offer.lastConfirmedAt` is set by:
- a stock update or price change,
- (re)activation,
- a CSV import row,
- accepting an order,
- `POST /v1/merchants/:id/offers/confirm` ("all my stock is accurate").

Offers older than `FRESHNESS_STALE_DAYS` (7) are `stale`: they are flagged and ranked after fresh offers.
Offers older than `FRESHNESS_HIDE_DAYS` (21) are left out of `publicOfferWhere` and checkout `purchasable` until reconfirmed.
Merchants get one reminder per day for offers about to go stale (`JobRunMark`).
Same-day orders get the accept SLA `min(merchant SLA, SLA_SAME_DAY_ACCEPT_MINUTES=15)`.

**Scorecard and quality score** (`domain/scorecard.ts`). Rolling 30/90-day metrics over paid merchant orders:
- acceptance rate,
- out-of-stock rejection rate,
- merchant cancellation rate,
- on-time ready rate,
- wrongPart (non-guaranteed) + notAsDescribed return rate,
- average minutes to accept,
- stock freshness (current).

`qualityScore = round(100 × Σ wᵢcᵢ / 100)` over 90 days. The components are:

| Component | Weight | Value |
| --- | --- | --- |
| stock | 30 | `1 − min(1, oos/10%)` |
| freshness | 20 | freshness rate |
| acceptance | 15 | acceptance rate |
| onTime | 15 | on-time ready rate |
| returns | 10 | `1 − min(1, rate/10%)` |
| speed | 10 | 1 at ≤15 min, 0 at ≥240 min |

Order-based components are shrunk toward 0.8: `(n·c + 5·0.8)/(n + 5)`.
Warnings (30 days) are raised when out-of-stock is above 3%, freshness is below 90%, acceptance is below 90%, on-time is below 90%, or bad returns are above 5%.
The score is cached on `Merchant.qualityScore`. It is exposed as `qualityScore` on offers and sellers and breaks price ties in offer ordering.
Offer ordering is: in stock, then fresh, then price, then quality. Search ranking is untouched.

Endpoints:
- Merchant: `GET /v1/merchants/:id/{commission-rates,scorecard,offers/freshness}`, `POST /v1/merchants/:id/offers/confirm`, and `GET /v1/merchants/:id/settlements` (now includes `payout`: next date, eligible, reserve held, in review).
- Ops: `GET|POST /v1/ops/commission-rules`, `PATCH /v1/ops/commission-rules/:id`, `GET /v1/ops/commission-rules/preview`, `PATCH /v1/ops/merchants/:id/economics`, `GET /v1/ops/merchants/performance`, `GET /v1/ops/merchants/:id/scorecard`, `GET /v1/ops/finance/margins`, `POST /v1/ops/settlements/run`.

## Sandbox vs production
The payment and carrier providers are **sandbox adapters**: no money moves, and tracking numbers (`SBX…`) are fake and
labelled as such. Production refuses to boot with sandbox providers or `AUTH_MODE=local`
(`src/config.ts`). Real payment-provider and carrier adapters implement `PaymentProvider` / `CarrierAdapter`.

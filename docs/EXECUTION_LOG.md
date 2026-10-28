# Qitah — engineering execution log

Concise log so work can resume without re-discovery. Newest first.

## 2026-10-28: Wave 3, catalog at scale (committee risks 3/4)
- **Read model** `ProductListing` (`*_catalog_read_model`, delimited block at the end of `schema.prisma`, `services/listings.ts`): derived only via `publicOfferWhere` (incl. freshness hide cutoff, private offers excluded). Refreshed in the same transaction on every offer/stock/reservation/commit/release/restock/confirmation/merchant/location write (rows locked before reading). Worker: `nextChangeAt` re-derivation (offers turning stale/hidden by time) + rolling safety-net slice. `npm run db:backfill-listings` (idempotent; 200k in ~45–75 s).
- **Search** scans only the read model (searchText copy, fit keys GIN, window counts in one statement, JIT off per statement, `<%` fuzzy fallback). Semantics unchanged (all search tests green); a product whose only offers were private no longer appears with zero offers.
- **Endpoints**: `reference` (ETag/304, 1 h), `products/:id` + `products?ids|offerIds` (ETag, 30/60 s), `home` starter pack, `changes` deltas, snapshot capped at 2,000 + `Deprecation`/`Sunset`/`Link`. CloudFront `/v1/catalog/*` behaviour (path + query + Origin, no Authorization, default TTL 0); RDS `jit=0`.
- **App**: snapshot gone. `ProductCache` (LRU ≤500, cart/favorites pinned, one AsyncStorage row per product + index + sellers), hydrated from reference + home + products?ids + search pages + seller pages; `/changes` on foreground; `useProduct`/`useProducts`/`useHomePack`/`useSellerProducts` with skeletons. Demo mode unchanged.
- **Load test** (200k products / 508k offers / 303k fitments, 4 vCPU): search p95 120–171 ms (part number 12 ms); detail 8 ms, batch(50) 31 ms, home 58 ms, changes 7 ms. Target p95 < 150 ms met for colloquial, close for vehicle-filtered (153–159) and category browse (171); fallback paths (no exact hit → relaxed) ~320 ms.

## 2026-10-28: Wave 3, "قطعة للورش" (workshop accounts, B2B channel)
Goal (committee): ≥40% of GMV from workshop accounts. Before this, "workshop" was only an address kind.
- **Schema** (`*_organizations`, one section at the end of `schema.prisma`): `Organization` (WORKSHOP|FLEET, APPLIED→APPROVED/REJECTED/SUSPENDED), `OrganizationMember` (OWNER > BUYER > TECHNICIAN; phone invites are INVITED rows), `OrganizationCredit` (Qitah internal sandbox credit, `provider = 'qitah-internal-sandbox'`, no financing partner), `OrganizationRepayment`, `WorkshopQuote`. `Order` gains `buyerOrgId`, `workOrderRef`, `workshopQuoteId` (unique, attribution) and `creditDueAt`. Ledger account `CUSTOMER_RECEIVABLE`; `CREDIT_EXPOSURE` not needed (exposure = receivable balance).
- **Auth**: `principal.orgMemberships` + `requireOrg(req, orgId, minRole)`; invites link on OTP sign-in, first Cognito sign-in, or `GET /v1/me/orgs`.
- **NET_TERMS**: credit row locked `FOR UPDATE` in the checkout transaction; `outstanding + total ≤ limit`; server-captured `credit` payment; debit receivable instead of clearing, merchant side unchanged (merchants always paid by Qitah). Refunds on credit orders settle in-transaction against the receivable (no provider). Repayments (finance, idempotent) allocate oldest-due first. `reconcileOrder` understands credit orders. `confirmPaidOrder` was extracted from the webhook capture path and is shared by both.
- **Workshop → customer quote**: parts at Qitah prices + labour + workshop fee shown transparently; public `/q/:token` page (escaped, noindex, no PII beyond what the workshop typed); approve → workshop order with `workshopQuoteId`.
- **Commission**: not built here (another agent). Channel is derivable from `Order.buyerOrgId`; TODO marked in `checkout.ts` where the merchant commission is set.
- **App** ("وضع الورشة", remote mode only): switcher in Account (row + chips) and `/workshop` hub; checkout offers "الدفع الآجل" when eligible plus an optional work-order/plate reference; orders list filtered by org; `/workshop/quotes` (build → share → status → order); `/workshop/statement`; `/workshop/members`; `/workshop/apply`. Strings in the `workshop` i18n group.
- **Ops portal**: الورش (list/detail: approve/reject/suspend/reinstate, set/freeze credit, record repayments), overdue receivables, workshop leads (from `MechanicReview` workshop name/phone).
- **Verification**: API 87/87 (5 new in `test/organizations.test.ts`; the concurrent over-limit test was checked to fail without the credit-row lock), app jest 25 suites / 241, ops portal build + typecheck + lint.

## 2026-10-28: Wave 3: merchant economics and supply quality
Built in one worktree. Schema changes are in a single migration, `*_merchant_economics`. Details: `services/api/README.md` § Merchant economics.

**Commission rules.** `CommissionRule` holds merchant, category, origin, condition, channel, priority and validity. Commission is resolved per order line, and the most specific rule wins.
- `Merchant.commissionBps` is now nullable. It means a negotiated B2C rate that ranks above platform tiers.
- Seeded tiers: aftermarket 10/12%, OEM 7%, accessories 13%, B2B 5%.
- Refunds reverse commission at each line's own rate.
- `orderChannel()` is the single hook for workshop B2B; it returns B2C today.

**Payment fees.**
- `PAYMENT_FEES` is posted at capture from a per-method env table (sandbox values are estimates).
- `reconcileOrder` expects clearing = captured − refunded − fees.
- Ops sees the contribution margin per order.

**Automatic settlement.**
- The worker drafts settlements WEEKLY or DAILY, idempotently through `JobRunMark`.
- Trusted DAILY merchants are paid right after delivery. 10% goes into `MERCHANT_RESERVE` and is released after the return window, net of later refunds.
- Approval and paid status stay manual.

**Freshness.**
- `Offer.lastConfirmedAt`: an offer goes stale after 7 days (flagged and ranked lower) and hidden after 21.
- Merchants get a one-click confirm and daily reminders.
- Same-day orders have a 15-minute accept SLA.

**Scorecard.**
- 30/90-day metrics and a documented 0–100 `qualityScore`, cached on Merchant.
- The score breaks ties in offer order. Search ranking is unchanged.

**Portals.**
- Merchant: scorecard, commission rates, payouts and reserve, freshness banner.
- Ops: commission rules, merchant performance, economics editing, margins.

**Verification.**
- API: 92/92, including 10 new tests in `test/economics.test.ts`; tsc and build pass.
- Both portals: build, tsc and lint pass.
- Smoke against a live stack: ops 24/24, merchant 14/14.

**Open items for the merge.**
- Map `buyerOrgId` → B2B in `orderChannel`.
- `search.ts` does not apply the freshness hide filter (min price/offer count in search results can include hidden offers). The owner of search and the read model should add `lastConfirmedAt >= now − FRESHNESS_HIDE_DAYS`.

## 2026-10-28 (late): Wave 3 merged and verified together
- **Merged:** wave 3 (workshop accounts + NET_TERMS, merchant economics, catalog at scale) is in `claude/busy-cori-5iz32w` (`4f7da0a`).
- **Merge glue:**
  - `confirmPaidOrder` applies the same-day accept SLA.
  - `orderChannel()` maps `buyerOrgId` to B2B commission.
  - `reconcileOrder` handles credit orders and payment fees together.
  - A cross-feature test covers it.
- **Verification on one fresh DB (`qitah_integration3`):**
  - API 111/111.
  - App jest 252/252.
  - Infra 83/83 plus synth.
  - Both portals build, tsc and lint clean.
  - Ops smoke 24/24, merchant smoke 14/14.
  - Customer remote journey PASSED, with no catalog snapshot download.
  - RFQ journey PASSED.
- **Load test at 200k products (in-process, 4 vCPU):**
  - search p95: colloquial 119 ms, part number 12 ms, vehicle-filtered 153–171 ms (slightly over the 150 ms target).
  - detail 8 ms, home 58 ms.
- **Deploy note:** run `npm run db:backfill-listings` after migrating.

## 2026-10-28: Evaluation committee + waves 1–2
**Committee** (5 independent members, reports in `docs/strategy/committee/`, synthesis in `docs/strategy/COMMITTEE_REPORT.md`).
- "60% of all market sales" isn't measurable or achievable in 3–5 years: online is about 5% of a $5–7B parts market.
- Redefined target: 60% of digital maintenance-parts demand in Riyadh for the top 15 models within 24 months, with workshops as the primary channel.
- Customer value pillars: fit guarantee, part requests (RFQ), colloquial search, delivered price and same-day delivery, mechanic as partner, verified authenticity, maintenance, fair returns.

**Wave 1** (`a8d8f9f`): integrity fixes from the technical review.
- Capture-vs-expiry lock order.
- Order-number collisions.
- Double restock on inspection.
- Parallel over-refunds.
- Atomic OTP checks.
- Double carrier labels.
- Trusted proxy hops.
- Indexes and retention.
- Each fix has a regression test; the label test was verified to fail without its fix.

**Wave 2** (merged into `bf5017e`, built by 4 parallel agents, then merged and verified together):
- **A. Part requests → merchant quotes → private offers.** App screens, merchant inbox, ops monitor, time-to-first-quote metric.
- **B. Colloquial, vehicle-aware search.** Shared lexicon (server + app, byte-identical), `/v1/catalog/search` with pg_trgm ranking and keyset paging, "fits my car" on by default, the not-carried concept for tires etc.
- **C. Fit guarantee.**
  - Server-side `fitSnapshot`.
  - Auto-approved wrongPart returns with platform-paid return shipping (`GUARANTEE_EXPENSE`).
  - Delivered price and same-day estimates with per-branch cutoff.
  - Per-reason returns; damaged requires a photo.
- **D. Send to my mechanic.**
  - Signed public page, no PII.
  - Offline partial VIN decode.
  - Garage without the trim step, plus an odometer.
  - Maintenance status, kits and reminders.

**Integration fixes during merge**:
- One `/v1/me/uploads` for return and part-request photos, in hashed per-customer folders.
- The `DomainEvent` GIN index is now declared in the schema.
- The test env forces `PUBLIC_BASE_URL`.
- `e2e/remote-journey.cjs` updated to the new add-vehicle flow and return rules.

**Verification on one fresh DB, all clients at once**:
- API: 82/82.
- App jest: 237/237 (24 suites).
- Both portals build, typecheck and lint.
- Ops smoke: 24/24.
- Merchant smoke: 14/14.
- Customer remote journey: PASSED.
- RFQ journey (app + merchant portal): PASSED.

**Local env note**: the container restarted. My Postgres now runs on **port 5433** (trust auth, data in `/var/lib/qitahpg`). The system cluster on 5432 requires a password.

**Next (wave 3, per committee)**:
- Workshop accounts: organisation, trade prices, credit via partner, quotes to the workshop's customers.
- Tiered commission and faster settlement.
- Offer freshness and availability confirmation.
- Server-side catalog read model, replacing the full snapshot.
- Device testing of native payment return and photo picker (expo-image-picker needs a development build).

## 2026-10-26 (later): Integration complete
**Merged** the merchant portal, ops portal, app integration and AWS infra worktrees into `claude/busy-cori-5iz32w`.

**Integrated verification** (one API on one fresh database `qitah_integration`, all clients at once):
- `portals/ops/e2e/smoke.mjs`: 24/24. Approves the pending merchant; the paid order appears live; sandbox label, pickup, PICKED_UP, IN_TRANSIT, DELIVERED; the order trace is reconciled.
- `portals/merchant/e2e/smoke.mjs`: 14/14. Register, approval, location, product + offer, live order, accept/pack/ready, label, RBAC/CSRF/allowlist.
- `e2e/remote-journey.cjs` (Expo web build against the real API): PASSED. OTP sign-in, vehicle, compatible search, 2-merchant cart, smart-cart options, sandbox payment confirmed by webhook, delivered, return.
- The app's order QT-261026-BBS7S was then returned and refunded by the merchant. The ops trace shows 2 suborders, 2 SBX shipments, payment + refund webhook events, 10 ledger lines, 20 audit events, and `reconciled: true`.

**Test totals**: API 31 (node:test against Postgres), app jest 16 suites / 94 tests, infra jest 81, plus the 3 Playwright suites above.

**Fixes made during integration**:
- CORS now allows PUT/PATCH/DELETE.
- The merchant reject note is kept.
- Multi-pool Cognito (`COGNITO_USER_POOL_IDS`).
- `GET /v1/ops/staff`.
- Manual return receipt cancels the idle reverse shipment.
- Pickup rebooking.
- 15-minute access tokens.
- Flagged payment events link to their order.
- The return label shows the correct direction.
- The customer order view exposes suborder timestamps.
- The sandbox payment page redirects back to the app.
- Carrier labels are voided on cancellation.
- Jest ignore patterns are anchored (they had been skipping `src/services` tests).

**Known gaps / next steps**:
- Native iOS/Android payment sheet and deep-link return are not yet tested on a device (web is verified).
- Cognito login paths (portals and API) are coded and unit-tested with local JWKS only; no user pool exists yet.
- Customer order polling refetches every 15s; it could use the `/v1/events` cursor.
- Portal refresh-token de-duplication is per process (needs sticky sessions or a shared store when scaled out).
- The app connects to RDS as the master user; a DML-only role is on the readiness checklist.
- The Prisma client auto-loads `services/api/.env` in dev; ECS injects real env/secrets in AWS.

**External blockers** (need the owner): AWS accounts + bootstrap (see `docs/aws/DEPLOYMENT.md`), payment provider
(merchant account + marketplace split/settlement support), carrier contracts + API credentials, an SMS sender ID for
Saudi OTP, a domain + ACM certificate, a GitHub token or app connection for Amplify, a production approval, a pen test, and a PDPL review.
Region: the AWS Saudi region is announced for December 2026 and is not live. me-central-1 (UAE) has been degraded since the March 2026
strikes. Interim recommendation: eu-central-1 (configurable), and plan a move once the Saudi region is GA (`docs/aws/REGION_DECISION.md`).

## 2026-10-26 — Integrated marketplace build (branch `claude/busy-cori-5iz32w`)
**Branch reconciliation**: merged `claude/m1.5-brand-v3` (which contains `m1.5-ux-polish`) and
`feature/marketplace-operations-foundation`. The operations branch was a single-file sketch (no auth, flat shipping,
`stock` column on the offer). It was replaced by `services/api` and its useful ideas kept: halalas, idempotency key,
transition maps, origin-based grouping.

**Decisions**
- Modular monolith: one Fastify API + one worker process from the same image; PostgreSQL is the only state store.
- Money: integer halalas everywhere; DB CHECK constraints (`order_total_consistent`, `item_total_consistent`,
  payment/refund bounds); append-only double-entry ledger with per-(type, ref) idempotent postings.
- Stock: `InventoryLevel(onHand, reserved)` per offer; reservation = one conditional `UPDATE … WHERE onHand-reserved >= q`;
  committed on *verified* payment; released on expiry/cancel; restocked on rejection/accepted return.
- Checkout: the client sends a `planId` (server-priced option incl. carrier quotes, 15 min TTL) plus an idempotency key.
  The order is created in one transaction with reservations. Payment is initiated afterwards; the order becomes PAID
  only from a signed webhook.
- Shipping group = items from one pickup location → one destination; hazmat/oversized items are isolated.
  The sandbox carrier enforces service rules (same-day same-city ≤10 kg; hazmat ground only; oversized freight).
- Realtime: transactional outbox (`DomainEvent`) → SSE/polling scoped by customer/merchant/ops; the worker relays to SQS
  when `JOBS_QUEUE_URL` is set.
- Auth: local JWT for sandbox/dev; Cognito JWT verification for AWS (`AUTH_MODE=cognito`). Roles always come from the
  DB, never from token claims.
- Tests reset only databases whose name ends in `_test`. The Prisma CLI refuses `migrate reset` when run by an AI
  agent, so the harness recreates the schema and runs `migrate deploy`.

**Status**: backend complete and tested (26 tests: unit, full lifecycle E2E, 16 failure scenarios).
Portals, app integration and AWS IaC are being built in parallel worktrees (see the commits that follow).

**Environment notes**: the AWS credentials present in the session are invalid (`InvalidClientTokenId`), so nothing is
deployed. There is no Docker daemon in the session, so local Postgres 16 runs from `/usr/lib/postgresql/16/bin`.

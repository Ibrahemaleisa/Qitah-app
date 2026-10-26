# Qitah — engineering execution log

Concise log so work can resume without re-discovery. Newest first.

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

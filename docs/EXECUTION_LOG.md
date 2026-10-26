# Qitah — engineering execution log

Concise log so work can resume without re-discovery. Newest first.

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

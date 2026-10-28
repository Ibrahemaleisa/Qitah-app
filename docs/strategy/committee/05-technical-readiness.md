# Committee member 5 — Technical readiness for scale

> Member report (2026-10-28), condensed. Findings are from code review; races were not reproduced by the reviewer.

**Verdict:** the money and stock foundations are well above average for this stage (31/31 tests pass). The catalog and search design is Phase‑1 sized only.

## Top 10 risks
| # | Sev | Where | Problem → Fix |
|---|---|---|---|
| 1 | High | `payments.ts` applyEvent vs expiry/cancel | Webhook locks Payment while expiry and cancel lock Order, so capture can race expiry and produce a PAID order with released stock. → Lock Order first, then use a conditional status update. |
| 2 | High | `lib/ids.ts`, `checkout.ts` | 5-char order numbers collide at scale, and the P2002 is misread as an idempotency race. → Use a longer code and retry. |
| 3 | High | catalog snapshot + app cache | Unbounded snapshot, CDN caching disabled, a single AsyncStorage blob. → Server search, starter packs, deltas. |
| 4 | High | `catalog.ts` search | `LIKE '%t%'` seq scans, OFFSET paging, no relevance ranking. → pg_trgm/tsvector, a read model, keyset paging. |
| 5 | Med‑High | `returns.ts` inspect | A double inspect restocks twice. → `inspectedAt` guard with a conditional update. |
| 6 | Med | refunds / return requests | Unlocked refundable checks. → Lock Payment/Order `FOR UPDATE`. |
| 7 | Med | `routes/events.ts` | Polling per connection, auth checked only at connect, missing indexes. → LISTEN/NOTIFY fan-out, token-bound lifetime. |
| 8 | Med | outbox | No retention, N+1 relay. → Purge or partition, batch. |
| 9 | Med | indexes | AuditEvent(entityId), LedgerEntry(merchantOrderId), Order(status, paymentExpiresAt), Refund(status); purge CheckoutPlan/ShippingQuote. |
| 10 | Med | OTP | Read-then-increment attempt counter, in-memory limiter, trustProxy=true. → Atomic update, Redis limiter, trusted hops only. |

Also: `createLabel` buys the label before locking (double-click buys two labels); no clawback for refunds after payout.

## Search architecture
- **Phase 2, Postgres (up to ~1M SKUs):**
  - an IMMUTABLE normalize function;
  - trigram + weighted tsvector indexes;
  - identifier prefix index;
  - `ProductListing` read model;
  - `VehicleConfig` + exploded `ProductFitmentKey`;
  - `/v1/catalog/search` with keyset paging;
  - CDN cache;
  - a 1M-SKU load test with p95 under 150ms.
- **Phase 3:** OpenSearch fed by the outbox, with Postgres as the source of truth.

## Schema additions (for value-add features)
- **VIN:** VinDecode.
- **Interchange:** PartInterchange.
- **RFQ:** PartRequest, PartRequestTarget, Quote, QuoteLine.
- **Workshops:** Organization, OrganizationMember, WorkshopProfile, InstallationBooking.
- **Maintenance:** MaintenanceTemplate, VehicleServiceRecord, MaintenanceReminder.
- **Prices:** OfferPriceHistory, ProductPriceDaily, PriceAlert.
- **Media:** MediaAsset, ProductImage.
- **Reviews:** Review tied to orderItem, SellerRating.
- **B2B:** PriceList, CreditAccount, Invoice (ZATCA).
- **Catalog structure:** Brand, Category tree.

## Observability gaps
- No request ids; `AuditEvent.requestId` is never set.
- The worker logs with `console.log`.
- No business metrics, no tracing, no app crash reporting.
- No nightly reconciliation; no admin replay tools.

## Plan (6 weeks)
1. **W1:** correctness fixes (1, 2, 5, 6, 10), indexes, purges, limits.
2. **W2:** observability, SSE fan-out.
3. **W2–3:** search v1.
4. **W4:** app on server search, device payment tests.
5. **W5–6:** media, reviews, price history, VIN, organizations, RFQ.

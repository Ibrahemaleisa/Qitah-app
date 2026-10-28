# Merchant platform (planned — not implemented in Milestone 1)

A separate **web dashboard** for independent merchants. The customer app and dashboard share the domain
vocabulary defined in `src/domain/types.ts` and `src/services/inventory/types.ts`.

## Capabilities

- Registration and business verification (CR number, VAT certificate, IBAN), store profile, policies
- Publish offers against canonical products; request new products when no match exists (catalog review queue)
- Stock and pricing management, bulk edits
- Order processing: accept, pack, print labels, hand over to carrier, partial fulfilment
- Returns handling and dispute workflow
- Settlements: commission, payment fees, payout statements, reconciliation exports
- Performance analytics: conversion, cancellation and on-time rates, ratings

## Inventory ingestion

Three methods feed one pipeline that produces `InventoryRecord`s:

1. **API connectors** — an `InventorySource` per integration (ERP / POS / WMS). Connectors are plug-ins with
   their own auth and cursor; **no ERP is hard-coded**. Supports pull (scheduled) and push (webhook) modes.
2. **Excel / CSV upload** — `FileImportSession`: detect columns → map columns (saved per merchant) →
   validate → preview with row-level issues → commit.
3. **Manual** — forms in the dashboard for small catalogs.

### Matching

Records are matched to canonical products by manufacturer part number + brand, then OEM cross-references;
unmatched rows go to a review queue rather than creating duplicate products.

### Freshness, conflicts and overselling

- Every record carries `sourceUpdatedAt`; offers older than a merchant-specific `FreshnessPolicy` are hidden or
  flagged as stale in the customer app.
  **Implemented (platform-wide policy, wave 3):** `Offer.lastConfirmedAt` is set by stock/price updates, CSV
  import, order acceptance and the "confirm all stock" action. Offers are stale after `FRESHNESS_STALE_DAYS`
  (flagged, ranked lower) and hidden after `FRESHNESS_HIDE_DAYS`. See `services/api/README.md`. Per-merchant
  policies and `InventorySource` connectors are still not implemented.
- Out-of-order updates are resolved by source timestamp (`stale_update`), concurrent dashboard edits are
  surfaced for review (`concurrent_edit`).
- Checkout places short-lived **stock reservations** (`StockReservationService`); visible stock = merchant
  stock − active reservations. A sync that would drop stock below reserved quantity keeps the reservation and
  raises `reserved_exceeds_stock` for the merchant to resolve.
- Failed syncs retry with backoff; repeated failures pause the connector and notify the merchant, and the
  affected offers fall back to the freshness policy.

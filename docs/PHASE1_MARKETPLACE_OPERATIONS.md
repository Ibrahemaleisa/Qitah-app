# Qitah — Phase 1 Marketplace Operations Contract
Status: IMPLEMENTATION BASELINE (2026-10-26). Decisions below are product decisions; provider integrations and legal policies remain unconfirmed.

## Objective
Support tomorrow's controlled merchant onboarding and a traceable customer order from sign-up through payment, fulfillment, delivery, returns and refunds. Never represent mock transactions as real. No Phase 2 or Phase 3 features in this milestone.

## Surfaces
1. Existing Expo iOS customer app: preserve existing UX and replace mock services behind stable adapters.
2. Merchant portal (responsive Arabic RTL web): invitation/application, verification, store profile, warehouse/pickup locations, staff roles, SKU/fitment catalog, price/stock, order queue, confirmation, pick/pack, pickup readiness, return inspection, settlements and audit history.
3. Qitah Virtual Warehouse portal (internal ops, responsive Arabic RTL): merchant locations, stock visibility (not Qitah-owned stock), fulfillment queue, grouping planner, shipping rates/labels/pickup requests, carrier tracking, exceptions, returns, SLA escalations and reconciliation.
4. Admin: merchant approvals, RBAC, support/disputes, commissions, financial exception queue, audit logs.

## Core invariant
A seller is not a shipment. Shipping groups are formed from compatible items at the same origin/pickup location to the same destination with compatible carrier/service/handling constraints. Multiple sellers may require multiple shipments; one seller may also require multiple shipments. Do not promise one shipping fee per seller without a validated rate.

## Data model minimum
users, roles, merchants, merchant_users, merchant_verifications, pickup_locations, vehicles, vehicle_fitment, products, product_identifiers, seller_offers, inventory_locations, inventory_levels, inventory_reservations, carts, cart_items, shipping_quotes, shipping_groups, orders, order_items, merchant_suborders, shipments, shipment_events, payments, payment_events, refunds, return_cases, return_items, settlements, payout_lines, notifications, audit_events.
Use immutable money amounts in minor units, currency SAR, stable IDs, timestamps, status transitions and tenant scoping. Product identity distinct from seller offer. Store price/shipping snapshot at checkout.

## Customer E2E
phone OTP -> garage or guest search -> exact/uncertain fitment -> product and seller comparison -> cart -> delivery home/workshop -> shipping quote and optimization -> confirmed checkout -> verified payment -> seller suborders -> per-shipment tracking -> delivered -> return/warranty case -> inspection -> refund/replacement -> resolution.
Show uncertainty rather than asserting fitment when data is incomplete. Explain savings as total landed cost and show delivery tradeoffs.

## Merchant E2E
apply -> verification -> approve -> configure pickup location and operating SLA -> add/import catalog -> verify fitment/condition -> publish offers -> update stock -> accept/reject suborder -> pick and pack -> ready for pickup -> handoff with scan -> handle returns -> payout reconciliation.
No cross-merchant data leakage. All state changes require authorized roles and audit trail.

## Warehouse E2E
order paid -> group fulfillable items by origin/handling/destination -> compare shipping quotes -> create shipment draft -> obtain carrier label -> schedule pickup -> track pickup scan -> in transit -> delivery proof -> exception escalation -> reverse shipment for approved return.
Internal portal manages orchestration, not physical inventory ownership. Carrier integration via adapter; include a clearly labeled sandbox adapter for demos, never fabricated production tracking.

## Payment and order safety
Checkout idempotency key; atomic order + inventory reservation policy; verify provider-signed webhooks; reconcile payment success with missing order; never rely on client-reported success; refund per order item/shipping policy; no payout before settlement eligibility; immutable financial ledger and auditable adjustments.
State machines must reject invalid transitions and duplicates. Release reservations on expiry/cancellation.

## Smart cart optimization
For each requested SKU/fitment, gather valid available offers. Optimize total = item prices + real shipping quotes + applicable fees - eligible discounts, subject to stock, fitment, shipping compatibility, ETA and merchant service constraints. Display: lowest total, fewer shipments, fastest delivery; explain tradeoffs. Do not claim an option is cheaper without valid quotes. Use deterministic algorithms, not LLM for monetary computation.

## Minimum pilot gates
- Merchant can register and receive approval, then create one valid offer with stock and pickup location.
- Customer can register, add vehicle, find compatible offer and see accurate final price/shipping.
- One real payment test in provider sandbox creates exactly one order despite webhook retries.
- One seller and multi-seller carts produce correct suborders and shipment groups.
- Merchant can accept, pack and hand off; warehouse can generate sandbox label and track states.
- Return/refund updates both customer and merchant views and financial ledger.
- Failed payment, stale stock, seller rejection, carrier delay, duplicate webhook and partial refund covered by tests.
- RBAC, tenant isolation, secrets, backup and monitoring verified before real customers.

## Build order — avoid token waste
1. Inspect existing project structure only once, reuse current components and design system.
2. Add backend modular-monolith schema, migrations, auth/RBAC and typed API contracts.
3. Build merchant portal E2E, then warehouse portal E2E, backed by real persisted states.
4. Integrate customer app against API; implement cart shipping optimizer.
5. Add payment/carrier provider adapters (sandbox first), event processing and notifications.
6. Run focused tests for changed modules; report working routes, credentials/configuration needed, and remaining blockers.

## External dependencies requiring explicit setup
Actual commercial shipping contracts, carrier credentials, payment-provider merchant account/marketplace settlement support, SMS provider, domain/hosting, commercial and tax requirements, and real merchant KYC documents. Do not mark these as completed or promise live orders until connected.

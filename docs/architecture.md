# Architecture

## Principles

1. **Customer app first, honest by default.** Fitment is only claimed when catalog data supports it;
   simulated services say so in the UI.
2. **Products are not listings.** A canonical `Product` describes the part; merchants publish `Offer`s
   against it. Customers compare offers on one page instead of scrolling duplicate listings.
3. **Adapters at every boundary.** Payments, logistics, inventory ingestion and visual search are interfaces.
   Mocks implement them today; real providers plug in without touching screens.
4. **Simple until proven otherwise.** Bundled sample data and local state now; the service functions already
   match the shape of the future API so TanStack Query can wrap them directly.

## Layers

```
 app/ (routes)  ─▶  features/ + ui/  ─▶  store/ (Zustand)  ─▶  services/  ─▶  domain/  ◀─  data/ (sample)
                                         i18n/, theme/                         ▲
                                                                    adapters: payments, logistics,
                                                                    inventory, settlement, visualSearch
```

- **domain/** — types and pure rules (`getFitStatus`, `estimatedTotal`, cart grouping, shipping fees). No React.
- **services/** — catalog search & ranking, order creation and lifecycle, and provider contracts.
- **store/** — `app-store` (persisted: language, garage, cart, favorites, addresses, orders, preferences) and
  `search-store` (ephemeral search/filter state shared with the filter & sort sheets).
- **features/** — marketplace-aware components; **ui/** — brand-agnostic primitives built on `theme/tokens`.

## Catalog model

| Entity | Notes |
| --- | --- |
| `Product` | Canonical part: brand, origin (`oem` / `aftermarket`), manufacturer part number, OEM cross-references, specs, fitment, product rating |
| `Fitment` | `modelId`, year range, optional engines, **source** `catalog` or `seller` |
| `Offer` | Seller's listing: price (SAR, VAT incl.), stock, condition (`new` / `used` / `refurbished`), warranty, dispatch days, delivery options |
| `Seller` | Verification, city, service rating (separate from product rating), on-time rate, response time, workshop-delivery support, free-shipping threshold |

Fit statuses: `catalogMatch` (catalog-backed), `sellerReported` (unverified), `bySpecification` (oil, bulbs,
batteries — matched by spec, never claimed), `noData`, `noVehicle`. Production will source fitment from a
licensed catalog (e.g. TecDoc-style data) and VIN decoding; nothing is inferred by AI.

## Orders & fulfilment

An order is split into **one shipment per seller**, each with its own carrier service, fee, tracking number and
timeline (`placed → confirmed → packed → shipped → outForDelivery → delivered`). In this milestone stages are
computed from the order time on a compressed demo clock; in production they come from merchant actions and
carrier webhooks. Cancellation is allowed until any shipment is handed to a carrier; returns open per line for
7 days after delivery.

## Payments (`services/payments`)

`PaymentProvider` exposes `checkEligibility`, `authorize` and `refund`. Production flow: the app requests a
payment session from the Qitah backend, which talks to the PSP (Apple Pay merchant validation, mada/card
tokenisation through the PSP's hosted SDK, STC Pay, BNPL redirects). The app never sees raw card data.
Settlement (`services/settlement.ts`) computes commission and payment fees per order line; merchants are paid
after the return window.

## Logistics (`services/logistics`)

`LogisticsProvider` covers `quote`, `createShipment`, `track`, `schedulePickup` and `createReturn`. The order
service will pick a provider per shipment (parcel, same-day courier, freight for bulky parts), with pickups
from the merchant and delivery to homes or workshops.

## Localisation & RTL

- Arabic is the source dictionary (`i18n/ar.ts`); English must satisfy the same type, so a missing key is a
  compile error.
- Layout direction is applied per screen from the selected language (`Screen`, sheets), so switching is
  instant. `Text` sets alignment and writing direction and isolates LTR runs (part numbers, phones) with
  Unicode isolates. Direction-sensitive icons mirror automatically. Horizontal lists compensate when the in-app
  direction differs from the native `I18nManager` direction (until the next launch).

## Path to production

1. Backend (catalog, offers, orders, auth) → replace `data/` reads with API calls behind TanStack Query.
2. Merchant dashboard + ingestion pipeline (see `merchant-platform.md`).
3. Real payment & logistics adapters on the server; webhooks drive order state.
4. Push notifications (`expo-notifications`), seller chat, analytics, crash reporting.

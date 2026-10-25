# قطعة · Qitah

**Find the right part. Compare your options. Get it delivered.**

Qitah is a Saudi multi-vendor marketplace for automotive spare parts. Independent merchants own their
inventory and pricing; Qitah connects customers to them, earns commission, and coordinates payment and
logistics partners. Qitah never buys, owns or warehouses parts.

This repository contains the **native customer app** (React Native + Expo), Arabic-first with full RTL
support and English localisation.

> **Milestone 1.5 — UX polish + Brand Guidelines v3.0** (branch `claude/m1.5-brand-v3`): see
> [`docs/ux-audit-m1.5.md`](docs/ux-audit-m1.5.md) and [`docs/brand-integration.md`](docs/brand-integration.md).
>
> **Milestone 1 status — demo build.** Every product, seller, price, rating and review is clearly-labelled
> sample data. Payments, shipping and order progress are **simulated**. See [Known limitations](#known-limitations).

---

## What's in Milestone 1

| Area | Highlights |
| --- | --- |
| Brand & design system | Official Qitah identity (Brand Guidelines v3.0): car + piece symbol, Qitah Blue / Orange, IBM Plex Sans Arabic · Sans · Mono, Lucide icons, design tokens (`src/theme/tokens.ts`), animated logo reveal, haptics |
| Onboarding | Animated splash, 3-step intro, Arabic default with instant English toggle, guest browsing, simulated phone-OTP sign-in |
| Vehicle garage | Multiple vehicles (make → model → year → trim → engine → optional VIN with ISO 3779 validation), quick switcher sheet; the selected vehicle drives ranking and fitment |
| Home | Prominent search, selected vehicle, live order strip, category grid, vehicle recommendations, featured, recently viewed |
| Search & discovery | Arabic/English text search (hamza/ta-marbuta-insensitive), part-number search incl. OEM cross references, category browsing, filter + sort sheets, “fits my vehicle” toggle, recent/popular searches |
| Unified catalog | Canonical `Product` vs merchant `Offer`; OEM / aftermarket / used / refurbished always distinct |
| Product details | Fitment panel (catalog-backed vs seller-reported vs by-spec), specs, OEM refs, compatibility list, product rating + sample reviews, offers |
| Offer comparison | Sort by estimated total (price + cheapest delivery), seller rating or delivery time; home/workshop toggle; cheapest / fastest / top-rated badges |
| Seller reputation | Separate **product** and **seller service** ratings, verified-purchase share, seller page with on-time rate, response time, contact entry point |
| Cart & checkout | Multi-seller cart (one shipment per seller), home or workshop delivery, address book, per-shipment shipping choice, Apple Pay / mada / card / STC Pay / Tabby / Tamara (all simulated, BNPL eligibility rules), VAT-inclusive summary, confirmation |
| Orders | History, detail, multi-shipment tracking timeline, cancellation (before carrier handover), returns (7-day window), seller contact |
| Account | Profile, vehicles, addresses, favorites, orders, language, notification preferences, FAQ/support, reset demo data |

State (garage, cart, favorites, addresses, orders, preferences) persists locally via Zustand + AsyncStorage.

## Tech stack

- **Expo SDK 58** · React Native 0.88 · React 19 · **TypeScript (strict)**
- **Expo Router** (file-based routes, native stack, native form sheets, custom tab bar)
- **React Native Reanimated 4** for purposeful motion
- **Zustand** (+ persist / AsyncStorage) for app state
- `react-native-svg` for the logo and part illustrations, `lucide-react-native` for UI icons (1.75 stroke)
- `expo-haptics`, `expo-localization` (RTL config), `@expo-google-fonts/ibm-plex-sans-arabic`, `ibm-plex-sans`, `ibm-plex-mono`
- Jest (`jest-expo`) for domain unit tests; Playwright scripts for end-to-end checks on the web build

TanStack Query is intentionally **not** installed yet — there is no remote data in this milestone. The
catalog service (`src/services/catalog.ts`) already exposes the query-shaped API it will wrap.

## Getting started

Requirements: **Node 20+** (22 LTS recommended), npm, and for iOS a Mac with **Xcode 16+**.

```bash
git clone https://github.com/ibrahemaleisa/qitah-app.git
cd qitah-app
npm install
```

### Run in the iOS Simulator

The app only uses modules bundled in Expo Go, so the fastest path needs no native build:

```bash
npx expo start          # then press  i  to open the iOS Simulator
```

Expo installs Expo Go into the booted simulator automatically (open Xcode once first so the simulator
runtime is installed: *Xcode → Settings → Components*).

To build a real native app in the simulator (recommended before TestFlight work):

```bash
npx expo run:ios        # generates ios/ via prebuild, builds with Xcode, launches the simulator
```

`ios/` and `android/` are generated (Continuous Native Generation) and git-ignored — configure native
behaviour in `app.json`, never by hand.

### Run on a physical iPhone

- **Quick:** install *Expo Go* from the App Store, run `npx expo start`, scan the QR code with the Camera app
  (phone and computer on the same network, or use `npx expo start --tunnel`).
- **Native build:** connect the iPhone by cable, then `npx expo run:ios --device`. Xcode will ask you to pick a
  signing team (a free Apple ID works for personal devices; enable *Developer Mode* on the phone).
- **Cloud build / TestFlight:**
  ```bash
  npm i -g eas-cli && eas login
  eas build --profile preview --platform ios       # internal distribution (ad-hoc)
  eas build --profile production --platform ios    # App Store build
  eas submit --platform ios                         # upload to TestFlight
  ```
  Change `ios.bundleIdentifier` (`com.qitah.app`) in `app.json` to an identifier you own first.

### Arabic / RTL behaviour

Arabic is the default. Each screen applies its layout direction from the selected language, so switching
language takes effect immediately. Native system chrome (swipe-back edge, system menus) follows
`I18nManager`, which the app updates on language change and iOS applies on the **next launch**.

### Checks

```bash
npm run typecheck       # tsc --noEmit (strict)
npm run lint            # ESLint (eslint-config-expo, React Compiler rules)
npm test                # Jest: fitment, pricing, offer comparison, search, checkout, order lifecycle
```

End-to-end (web build + Playwright, used to verify Milestone 1 without a Mac):

```bash
npx expo export --platform web --output-dir dist
node e2e/serve.cjs "$PWD/dist" 8081 &
mkdir -p e2e/shots
node e2e/journey.cjs e2e/shots        # full Arabic journey: onboarding → order → tracking → English
node e2e/widths.cjs e2e/shots         # 320/375px overflow checks, Arabic + English
```

## Project structure

```
src/
  app/                 Expo Router routes (screens only)
    (tabs)/            Home, Search, Cart, Orders, Account
    product/[id]       Product details        offers/[productId]  Offer comparison
    seller/[id]        Seller profile         garage/             Garage + add-vehicle flow
    checkout/          Checkout + confirmation order/             Order details, cancel & return sheets
    ...                sheets (filters, sort, vehicle switcher, seller contact), account sub-pages
  brand/               Logo mark, animated splash, part illustrations
  theme/tokens.ts      Design tokens — colours, type scale, spacing, radii, motion
  ui/                  Design-system primitives (Text, Button, Card, Input, Chip, Sheet rows, Toast…)
  features/            Marketplace components (ProductCard, OfferCard, FitPanel, TabBar, timelines…)
  domain/              Types and pure business rules (compatibility, pricing)
  data/                SAMPLE catalog: vehicles, products, sellers, offers, reviews
  services/            Catalog queries, order simulation, and adapter contracts:
    payments/          PaymentProvider interface + simulated provider
    logistics/         LogisticsProvider interface + mock carrier
    inventory/         Merchant ingestion contracts (API / file / manual), sync & reservations
    settlement.ts      Commission and merchant settlement model
    visualSearch.ts    Future image-search contract
  store/               Zustand stores (persisted app state, search UI state)
  i18n/                Arabic (source) and English dictionaries, formatting helpers
  lib/                 Small utilities (text normalisation, haptics, ids, vehicles)
docs/                  Architecture & merchant platform plans
scripts/               Brand asset generator (icon / splash PNGs from the SVG mark)
e2e/                   Playwright end-to-end scripts for the web build
```

More detail: [`docs/architecture.md`](docs/architecture.md) · [`docs/merchant-platform.md`](docs/merchant-platform.md)

## Environment variables

None are required for Milestone 1. See [`.env.example`](.env.example) for the variables reserved for the
API milestone. Only `EXPO_PUBLIC_*` variables reach the app bundle — **never put secrets in them**;
payment and logistics credentials live on the server.

## Roadmap

| Milestone | Scope |
| --- | --- |
| **1 — Customer experience (this)** | Native app, design system, full simulated journey on sample data |
| 2 — Marketplace backend | Catalog & offer APIs, auth (phone OTP), orders, TanStack Query in the app, real fitment data licensing |
| 3 — Merchant dashboard (web) | Onboarding & verification, offers, CSV/Excel import with mapping, ERP connector framework, order processing |
| 4 — Payments & logistics | PSP integration (Apple Pay, mada, cards), BNPL, carrier adapters, webhooks, refunds, settlement & reconciliation |
| 5 — Launch readiness | Push notifications, seller chat, analytics, accessibility audit, dark mode, App Store submission |

## Known limitations

- **All data is sample data**, bundled in the app. Brands marked aftermarket and all sellers are fictional; part
  numbers, fitment, prices, ratings and reviews are illustrative and labelled as such in the UI.
- **Payments are simulated.** No card data is collected, nothing is charged, every result is flagged `simulated`.
- **Shipping and order progress are simulated** on a compressed clock (minutes, not days); carriers are mocks.
- Sign-in is a local simulation (any 4-digit code); there is no backend account.
- Seller messaging, push notifications and image search are entry points / contracts only.
- Light theme only; the brand guidelines don't define a dark UI theme yet.
- Part imagery uses generated geometric illustrations in place of photography.
- **Not yet run in the iOS Simulator.** Milestone 1 was built on Linux: verification covered strict type-checking,
  Jest domain tests, a successful iOS (Hermes) bundle export, and Playwright end-to-end runs of the web build in
  Arabic and English. Native-only behaviour (haptics, form-sheet detents, Apple-style transitions) needs a Mac pass.

## License

Proprietary — © Qitah. All rights reserved.

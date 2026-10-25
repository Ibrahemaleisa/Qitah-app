# Brand integration — Qitah Brand Guidelines v3.0 (2026-10)

The app implements the approved identity from *Qitah Brand Guidelines v3.0*. Page numbers below refer to
that document.

## What was applied

| Area | Implementation | Source |
| --- | --- | --- |
| Symbol | Official car + piece geometry **extracted from the guideline PDF's vector artwork** (not redrawn): `src/brand/symbol.ts`, SVG exports in `assets/brand/` | p.4–7, p.29 |
| Lockups | Arabic horizontal (symbol right of «قطعة») and Latin (symbol left of «Qitah»), never mirrored; dark / primary colourways | p.5–8 |
| App icon | Qitah Blue background, white car, orange piece, symbol at 72% width, 1024px square without corners | p.16 |
| Splash | White background; car enters and settles (0–250ms), piece approaches (450ms) and fits (650ms), name appears (900ms); Reduce Motion → simple fade | p.25 |
| Palette | Qitah Blue `#022B74`, Qitah Orange `#FE680E`, White; Blue 600, Blue 50, Mist, Slate, Ink; Success, Warning, Error, Orange Text | p.10 |
| Colour use | Mist/white grounds, blue for headings, buttons and dark surfaces; orange only as the signal: the piece in the logo, the selected/best offer marker, the active tab icon, the "current" step | p.11, p.14, p.15 |
| Typography | IBM Plex Sans Arabic (Arabic UI, 700 headings / 400 body), IBM Plex Sans (English UI, prices with tabular figures, Latin runs at 90%), IBM Plex Mono (part numbers, VINs at 90%) | p.12–13, p.30 |
| Prices | Western digits, two decimals, IBM Plex Sans Bold tabular figures, smaller grey «ر.س» after the amount | p.13, p.21, p.30 |
| VIN | Mono, split 9 + 8 with a non-breaking space | p.30 |
| Icons | Lucide line icons at 1.75 stroke, rounded caps; ink / white, orange only for the active state; car icon for "my vehicles", wrench for workshop, cart for the cart | p.15 |
| Shape & spacing | Radii 6 badges · 12 elements · 16 cards · full chips; 4px spacing scale; 16px mobile margin | p.23 |
| Buttons & states | One blue primary action per screen; outlined blue secondary; grey disabled state; spinner while loading | p.21, p.33 |
| Compatibility | "Fits your car" = full symbol + text; "Needs confirmation" = car only, dashed card; never colour alone | p.21, p.31 |
| Order tracking | Completed = blue check circles, current = full symbol, upcoming = empty circles, text always shown | p.31 |
| Selected offer | Blue border + orange piece marker in the top corner | p.14, p.21 |
| Motion | 150–250ms (sheets ≤300ms), cubic-bezier(0.23, 1, 0.32, 1), opacity/transform only, scale from 0.95; cart add drops a small orange piece into the cart icon within 250ms; Reduce Motion respected | p.25 |
| Voice | Clear, confident Modern Standard Arabic; no stacked exclamation marks; specific errors (e.g. payment failure copy) | p.22 |
| Product imagery | Placeholder illustrations on the official `#ECEAE6` backdrop, neutral graphite with Blue 600 details | p.24 |

## Adaptations for mobile (documented deviations)

- **Type scale** — the guideline scale (Display 64 / H1 44 / H2 32 / H3 22 / Body 16 / Caption 13) targets print
  and web. On phones the same weights and Arabic line-height ratios are kept with smaller display sizes
  (30 / 24 / 20 / 17); Body 16/27 and Caption 13/21 are used as specified.
- **Primary button colour** — p.11 lists "the most important action button" as an orange use, while the app-specific
  pages (p.21, p.33) specify a blue primary button and orange for markers only. The app follows p.21/p.33.
- **Order tracking** is vertical (p.31 shows it horizontally) so six stages with timestamps fit a phone width.
- **"Doesn't fit" state (p.31)** is not used: the catalog has no negative fitment data, so the app shows
  "No fitment data" with the faint car instead of claiming incompatibility.
- **Latin inside Arabic** — Plex Sans at 90% is applied to explicitly marked runs (numbers, brands, models, prices,
  part numbers); free-text Latin inside Arabic sentences stays in Plex Sans Arabic, which contains matching Latin glyphs.
- **Wordmark** — set in IBM Plex Sans Arabic / IBM Plex Sans Bold as the guidelines specify; replace with the
  official outlined wordmark SVGs (`qitah-wordmark-ar-*.svg`) when the logo file package is delivered.

## PROPOSED additions (not in the guidelines — need brand sign-off)

| Token | Value | Why |
| --- | --- | --- |
| `line` / `lineStrong` | `#E3E8F0` / `#CBD3E1` | Card borders and dividers |
| `textTertiary` | `#667089` | Secondary captions; Slate is too dark for tertiary text, Gray `#8A94A8` fails AA for small text |
| `warningText` | `#A2540A` | Warning `#D97706` is ~3:1 on white — fine for icons, too low for text |
| Soft status fills | success `#E6F2EB`, warning `#FCF0E0`, error `#FAE8E8`, orange `#FFEFE4`, teal `#ECF6F5` | Badge backgrounds |
| On-blue text | `#C8D3E8` / `#94A6CC`, border `#1C4594` | Secondary text and outlines on Qitah Blue surfaces |
| Condition colours | New = success, Used = warning, Refurbished = teal `#0F7A78` (from the ID/chart palette) | The guidelines don't assign colours to part condition |
| Radius 24 | Bottom sheets and the product hero sheet | Larger surfaces than "cards" |

## Open items

- Dark UI theme is not defined in the guidelines (only logo-on-dark usage); the app stays light.
- The new Saudi Riyal sign is not supported by the fonts yet; «ر.س» is used as specified (p.30).
- Real product photography should follow p.24 when merchant imagery exists.
- Request the official logo file package (`/svg`, `/png`, `/app-icon`, `/tokens`, p.29) to replace the extracted
  symbol and typeset wordmark with the canonical files.

## Where the values live

`src/theme/tokens.ts` (palette, semantic colours, type, spacing, radii, motion), `src/theme/motion.ts`
(easing helpers), `src/brand/` (symbol, logo, splash, illustrations), `scripts/generate-brand-assets.mjs`
(icon / splash PNGs: `npm run brand:assets`).

# Milestone 1.5 — UX & native polish audit

Scope: brand-independent quality. The visual identity (logo, colours, typeface) stays **provisional**
until the redesigned brand guidelines are approved — see `brand-integration.md`.

Findings are ranked by impact on the core journey
*find → verify fit → compare sellers → choose delivery → pay → track*.

| # | Area | Problem found | Impact | Fix |
|---|------|---------------|--------|-----|
| 1 | Offer card | Part price, shipping and total are split across two columns; "est. total" is easy to miss | High — the core comparison is ambiguous | Explicit 3-line breakdown: part price / delivery / total |
| 2 | Comparison | "Cheapest / fastest / top rated" badges compare *new* against *used* offers | High — misleading | Highlights are computed within one condition; label names the condition when conditions are mixed |
| 3 | Product sticky bar | "Best price · Add to cart" adds an offer without saying which seller or condition | High — user can't tell what they're buying | Footer names condition and seller of the offer being added |
| 4 | Checkout | Pay button can be disabled with no explanation (no address, signed out, workshop-incompatible seller, BNPL limit) | High — dead-end feeling | Blocker list above the button with a direct fix action |
| 5 | Search | Zero results on small typos; no guidance when "fits my vehicle" hides everything | High | Forgiving fallback (partial / 1-typo match, clearly labelled), contextual recovery actions, category suggestions, part-number mode hint |
| 6 | Dynamic Type | Fixed line heights with scaling fonts clip or overlap text at large accessibility sizes | High (a11y) | Line height scales with font scale; sensible maximum multipliers |
| 7 | Screen readers | Headings not announced as headers; decorative art and badge fragments read individually; product cards announce only the name | Medium–High | Header roles, hidden decorative art, descriptive card labels (price, fit, offer count) |
| 8 | Touch targets | Icon buttons 42pt, quantity stepper 32pt, chips 36pt | Medium | ≥44pt via size or hit slop |
| 9 | Product page | Specs, description and compatibility compete for attention before the user knows price and delivery | Medium | Summary strip (price from, fastest delivery, warranty, conditions) and collapsed spec list |
| 10 | Large headers | Empty 44pt row above large titles wastes the first screen on tab pages | Medium | Collapse the row when there's no back/actions |
| 11 | Home | Decorative "04465-…" chip looks tappable; the sample-data banner competes with search and vehicle | Medium | Remove chip; compact "demo" label in header, full disclosure lower on the page |
| 12 | Orders list | Multi-shipment orders show one status; per-seller progress is hidden until opened | Medium | Per-shipment progress bars on order cards |
| 13 | Feedback | Favorites and vehicle switching change state silently; cart badge doesn't react to adds | Medium | Toasts + haptics; cart badge bump |
| 14 | Reduced motion | Splash always plays its full 1.35 s sequence | Low–Medium | Shortened, static splash when Reduce Motion is on (layout animations already follow the system setting) |
| 15 | Robustness | A render error shows the default red screen / blank page | Medium | Root error boundary with retry |
| 16 | Brand readiness | Some screens use raw palette values instead of semantic tokens | Low now, high at rebrand | Semantic roles only outside `src/brand` and `src/theme` |

Deliberately **not** changed: navigation structure, data model, compatibility rules, pricing/shipping logic,
cart, order lifecycle, localisation content — they tested well in Milestone 1.

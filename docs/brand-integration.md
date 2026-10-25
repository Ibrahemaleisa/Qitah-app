# Brand integration guide

**Status: the visual identity is provisional.** The Qitah brand is being redesigned separately. The current
logo mark, orange / charcoal / warm-white palette and IBM Plex Sans Arabic are Milestone 1 placeholders and
must not be treated as approved. Milestone 1.5 made no identity decisions; it isolated them.

## Where brand values live

| What | File | Notes |
| --- | --- | --- |
| Raw palette | `src/theme/tokens.ts` → `palette` | Only `src/theme` and `src/brand` may import it |
| Semantic colours | `src/theme/tokens.ts` → `colors` | What every component uses (`accent`, `inverse`, `textSecondary`, `success`, part-origin colours…) |
| Typeface | `src/theme/tokens.ts` → `fonts`; font loading in `src/app/_layout.tsx` | Swap the `@expo-google-fonts/*` package or bundle files with `expo-font` |
| Type scale | `src/theme/tokens.ts` → `typeScale` | Sizes and line heights; Dynamic Type scaling is automatic |
| Shape & spacing | `radius`, `space`, `gutter`, `shadow` | |
| Motion | `motion` + components in `src/ui/Pressable.tsx`, `src/brand/BrandSplash.tsx` | |
| Logo | `src/brand/Logo.tsx` (in-app), `scripts/generate-brand-assets.mjs` (icon / splash PNGs) | Re-run `npm run brand:assets` after replacing the mark |
| Splash | `src/brand/BrandSplash.tsx`, `app.json` → `expo-splash-screen` | |
| Product imagery | `src/brand/PartArt.tsx` | Placeholder illustrations until merchant photography exists |

## Integration checklist (when guidelines are approved)

1. Map the guideline palette onto `palette`, then check every **semantic role** in `colors` still makes sense —
   especially `accent`, `inverse*`, status colours and the OEM / aftermarket / used / refurbished roles.
2. Verify contrast (WCAG AA: 4.5:1 body text, 3:1 large text and UI) for `text*` on `background` / `surface`
   and `textOnAccent` on `accent`.
3. Replace fonts and re-tune `typeScale` line heights for the new Arabic face.
4. Replace the logo component and regenerate icons and splash.
5. If the guidelines define a dark theme, add a dark `colors` set: components already read colours only through
   semantic tokens, so a theme hook can switch the set without screen changes.
6. Run `npm run typecheck && npm test && npm run lint` and the e2e scripts in both languages.

## Open questions for the brand team (not decided here)

- Accent colour and whether a secondary accent exists
- Arabic + Latin typeface pairing and weights
- Dark theme requirement
- Icon style (currently Feather line icons as a neutral placeholder)
- Illustration vs photography direction for parts

# Batch L — Per-screen wallpapers & visual identity

> Source: `docs/planned_upgrades.md` § Batch L (user request, 2026-07-02). Extension of the shipped dynamic-background system — NOT a greenfield build. Three PR-sized chunks in dependency order: foundation first (nothing shows until roots are transparent; nothing ships until light mode is solved), then art screen-by-screen. **Hard constraint throughout: body text ≥4.5:1 contrast over any wallpaper, in both themes.**

## Chunk 1 — Foundation: reveal + legibility (L3 + L2, one PR, no new art)

1. **Opaque-root cleanup (L3).** Convert the screens rooted in opaque `bg-background` — stats, overview, timeline, session-explain, admin, profile, auth — to `bg-page` so the fixed background layer shows through. Verify each screen against the *existing* home dynamic wallpaper before any new art exists: this chunk alone must not regress readability anywhere (the global `ScrimLayer` already sits behind content).
2. **DetailHero decision:** the 4 health detail pages keep their bespoke `PAGE_GRADIENTS` art (recommended in the audit — they already satisfy the per-screen goal). Record the decision in the code where `pathnameToSection` maps them, so L1 skips those routes.
3. **Light-mode scrim system (L2).** The blocker: DetailHero hardcodes `text-white` + dark scenes. Build theme-aware scrim + palette plumbing now: each palette entry carries `{dark, light}` variants (light = white-gradient scrim, desaturated/lightened art tones); `ScrimLayer` reads the active theme. Retrofit DetailHero onto it as the proof (fixes the known light-mode bug there and validates the mechanism before per-screen art multiplies it).
4. **Workout exclusion:** confirm the active in-progress workout stays `bg-black` (`workout-screen.tsx` root) — wallpaper participates only on pre/select/summary/done sub-screens.

**Verify:** every converted screen in BOTH themes on `pnpm dev` (toggle `.dark`); text contrast spot-checks ≥4.5:1 (pick the worst text-over-art spots); `--page-bg` set/teardown still works across navigation.

## Chunk 2 — Per-screen keys + settings + first screens (L1, one PR)

5. **Refine `pathnameToSection`** from 5 buckets to per-route keys — home stays `dynamic`; DetailHero routes excluded per chunk 1. Extend the Zustand `ta_background_settings` store to `Record<key, boolean>` **with a rehydration migration from the old 5-bucket shape** (persisted-store rule: decide the migration at the time the shape changes), and add the per-screen rows to `dynamic-background-settings.tsx`.
6. **Palette definitions per screen** alongside `lib/background/palettes.ts` — CSS gradients / `conic-gradient` scenes only (no raster assets, no complex SVG — the Samsung compositor risk in L4). Both theme variants per palette from day one, via chunk 1's plumbing.
7. **Ship 3 screens as the pattern-proof**: nutrition, health (list view), more/profile — each a lightweight themed gradient scene behind the standard scrim. Static scenes (reduced-motion safe by construction); anything animated must sit behind the existing particle gating.

**Verify:** per-screen toggle works and persists; each shipped screen in both themes; navigation between wallpapered and non-wallpapered screens doesn't flash (the single fixed layer just re-themes).

## Chunk 3 — Remaining screens + device pass (one PR)

8. **Roll out the remaining routes** (stats, overview, timeline, workout-select, session-explain, config/admin/auth as taste dictates) using the chunk-2 pattern — this is palette work, not system work; keep each scene a few CSS layers.
9. **On-device verification pass (the real gate):** wallpapers behind card grids are exactly the Samsung-compositor class that wipes sibling gradients — check every wallpapered screen on the S25 in both themes; apply `willChange: 'transform'` promotion where cards sit over art; confirm scroll performance (the layer is `fixed`, but repaint cost is device-only evidence).

**Verify:** full screen-by-screen APK pass (both themes, reduced-motion on/off) — record it against J2's device smoke checklist if that has shipped.

## Wrap-up (per chunk)

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; both-theme manual pass per chunk on `pnpm dev`.
- Unexercised in sandbox (declare in every PR): Samsung WebView compositor behaviour, real scroll/repaint cost, insets — the whole batch's risk lives on-device.
- Minor version bump + changelog when chunk 2 lands (user-visible feature); tick L1–L3 in `planned_upgrades.md` as chunks land.

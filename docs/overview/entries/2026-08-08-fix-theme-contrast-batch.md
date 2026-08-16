## 2026-08-08 — `fix/theme-contrast-batch` — Q-132 part 2: the light-theme literals, the duplicated palettes, and the colour-only bands

Closes **Q-132** (review [§3.17, §4](../../reviews/2026-08-07-full-app-review.md)). Part 1 (`ScreenPaletteLayer`
→ `--screen-palette-*` CSS variables) shipped in v1.270.15 / #1154; this is everything else in that
entry, so the backlog item is **removed**, not annotated.

### 1. Dark-only literals on surfaces a light-theme user reaches

`rgba(255,255,255,α)` is invisible on a light background. Replaced with the theme tokens that already
mean the same thing in both schemes — `var(--border)` for hairlines and dividers (in dark it *is*
`oklch(1 0 0 / 7%)`, i.e. exactly the literal it replaces), `var(--muted)` for inset surfaces,
`var(--muted-foreground)` for de-emphasised text:

`health/strength-progress-card.tsx` · `oura-score-chip-row.tsx` · `profile/achievements-grid.tsx` ·
`more/profile-tab.tsx` · `home/home-card-widget.tsx` · `profile/level-sheet.tsx`.

**Two sites the backlog list did not name, found by re-running the grep after the listed ones were
done, and fixed here under the sibling-surface rule:**

- `components/home/score-ring-frames.tsx` (4 literals) — **this is what the entry meant by "SVG ring
  frames, rendered on Home"**, not the chip row it cited. The frames were split out of
  `oura-score-chip-row.tsx` in the 2026-08-07 round and the line numbers went with them. Confirmed
  in the before shot: in the light theme the four Home scores had **no ring at all**. Now
  `color-mix(in oklch, var(--foreground) 45%, transparent)`.
- `app/health/day/day-detail-content.tsx:27` — the same `borderLeft: 1px solid rgba(255,255,255,0.1)`
  divider that `oura-score-chip-row` had two copies of.

Also swept the eight `text-white` / `#fff` literals in `oura-score-chip-row.tsx` and one in
`achievements-grid.tsx` → `text-foreground` / `var(--foreground)`. These are the same bug wearing a
different hat: the Home score numbers rendered white-on-white in the light theme.

**Recounted after the sweep: 22 `rgba(255,255,255,…)` sites remain across 9 files, and all of them
are fine.** Six are scheme-conditional pairs (`isLight ? 'rgba(0,0,0,…)' : 'rgba(255,255,255,…)'` in
`hr-day-chart`, `health-score-detail`, `end-of-day-review`, `heart-rate/page`), which is the shape
CLAUDE.md prescribes; the rest are `pip-view.tsx` (root is `bg-black`, already noted exempt),
`detail-hero.tsx` hero art and `particles.tsx` decoration. **No follow-up entry filed, because there
is no remaining finding** — not because they were skipped.

### 2. Duplicated palettes → one function each

- **`scoreBandByLabel(label)`** added next to `scoreBand(score)` in
  `packages/shared/src/health/score-band.ts`, for the callers that hold the band *label* and were
  re-hardcoding the three hexes to colour it. Adopted in `readiness-card.tsx` (which hand-rolled
  `labelColor` **in a file already importing `scoreBand`**) and in the contributor-chart legend.
- **`components/health/score-band-legend.tsx`** — the three labelled swatches extracted from
  `contributor-chart.tsx`, now shared. A legend is what assigns the colours their meaning, so a
  second drifting copy would make the legend lie about the chart.
- **`packages/shared/src/health/body-battery-band.ts`** — one `bodyBatteryColor(label)` replacing
  two divergent implementations of the same concept: a continuous `hsl()` ramp keyed on the number
  (`body-battery-card.tsx`, theme-blind) and a three-token map keyed on the label
  (`nutrition/end-of-day/day-summary-card.tsx`). The token map won; the ramp's continuity bought
  nothing, since both call sites paint a single colour for the whole card. Keyed on the **label**
  because `/api/body-battery` already computes the band — `BatteryIcon` was re-deriving the same
  75/50/25 tiers client-side, which was a second copy of that formula. The route now imports
  `BodyBatteryLabel` as its response type so the two cannot drift.

### 3. Colour-only state → paired with the band label

Following `health/health-score-detail.tsx:62`'s shape:

- `app/session-explain/components/score-ring.tsx` — band label under the score.
- `app/session-explain/components/alternatives-card.tsx` — band label under each session's score.
- `components/readiness-card.tsx` — one `ScoreBandLegend` under the three contributor groups
  (one key for all three, not one per group).

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors (99 pre-existing warnings) · `vitest run` **3233 passed /
  12 skipped**, the single failing *file* being the known seeded-local-DB harness problem in
  `scale-ble-multi-reading.test.ts` (backlog **Q-146**) · all eight custom-rule scripts pass.
- **Rendered and compared in both themes** at the S25 viewport (412×915) against `pnpm dev` as a
  logged-in user: Home (score chip row, ring frames, body-battery card), and — via a **temporary
  probe route rendering the changed components with fixtures, deleted before commit** — the
  contributor chart + legend, both score rings, the alternatives card, the achievements grid's
  locked tiles, the strength-progress card's toggle and percentage markers, and both
  day-summary battery pills. The probe was necessary because the seeded local DB has no Oura
  contributor data, so `/health` and `/health/readiness` sit on skeletons indefinitely.

### Not exercised

No device run — these are CSS-token and markup changes with no native, safe-area, gesture or
notification path. Not seen rendered: `profile/level-sheet.tsx`, `more/profile-tab.tsx`'s season
badge, and `home-card-widget.tsx`'s empty-donut fallback — each is a single one-line swap to
`var(--border)` / `var(--muted)`, both of which *were* verified rendering correctly in both themes
elsewhere in the same run, but the specific surfaces were not opened. Samsung WebView rendering of
`color-mix(in oklch, …)` in an SVG `stroke` attribute (`score-ring-frames.tsx`) is unverified —
Chromium desktop renders it correctly, and the file's sibling `stroke="var(--border)"` usage is
already live, but the APK is the authoritative check.

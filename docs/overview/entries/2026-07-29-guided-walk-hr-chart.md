## 2026-07-29 — Guided walk: HR chart with fast/slow phase shading

Implements Phase C of the guided-walk uplift plan
(`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`), the second of three follow-on PRs
after the GPS/pace/map work (`docs/overview/entries/2026-07-29-guided-walk-gps.md`).

### Reconciliation before implementing
The backlog flagged a possible overlap with the shipped per-session visual system
(`ActivityDetailSheet`'s hero HR/pace chart). That system renders on the regular activity detail
sheet — a different screen from the guided walk's own post-walk summary
(`components/guided-walk/walk-summary.tsx`), which has always had its own simpler per-interval bpm
list. No overlap; the plan wasn't redundant.

### What shipped
- **`components/activity/phase-bands-plugin.ts`** — a small custom chart.js plugin
  (`beforeDatasetsDraw`) that paints a translucent background rect per phase band behind the HR
  line, reading pixel positions off the chart's own x-scale. No new dependency
  (`chartjs-plugin-annotation` isn't in the repo) — checked first per the plan's explicit
  guidance. Kept in its own **non-JSX** module deliberately: this repo's `vitest.config.ts` has no
  React/JSX transform configured, so a `.tsx` file can't be imported into a test at all — importing
  a pure `.ts` module was the only way to unit test the draw logic.
- **`ActivityHrChart`** (`components/activity/activity-hr-chart.tsx`) gained an optional
  `phaseBands?: PhaseBand[]` prop, registers the new plugin, and resolves fast/slow band colors via
  `resolveColor()` (chart.js can't paint a raw `var(--x)` CSS custom property — canvas `fillStyle`
  silently falls back to black). Regular activities that don't pass `phaseBands` are unaffected —
  one chart implementation, not a fork.
- **`walk-summary.tsx`** — computes `phaseBands` from `plan.segments` (fast/slow only, minutes from
  walk start) and renders `ActivityHrChart` (dynamically imported, `ssr: false`, matching the
  sibling `activity-detail-sheet.tsx` call site's existing pattern — chart.js is SSR-unsafe and
  bundle-heavy) above the existing per-interval pace/HR list. Supplements rather than replaces that
  list, per the plan's explicit allowance — the list's precise per-segment numbers (added in the
  prior GPS PR) are still useful alongside the chart's visual overview.
- 4 new unit tests (`components/activity/__tests__/activity-hr-chart-plugin.test.ts`) on the
  plugin's pixel-mapping logic against a mock chart object: no bands configured, empty bands array,
  correct fill-rect calls for a 2-band scenario, and the pre-layout guard (no `chartArea` yet).

### Verification
- Full gate: lint (0 errors), `tsc --noEmit` (clean), full test suite (2572 passed; the one
  `claude-ro-readonly-role` failure is this sandbox's local `DATABASE_URL` unix-socket format not
  being parseable by the WHATWG `URL` constructor the test itself uses — unrelated file, documented
  in the prior GPS-work entry, would run fine in CI's docker-postgres).
- Dev-server Playwright smoke: completed a guided walk (mocked GPS movement, same harness as the
  GPS PR) and confirmed the summary screen renders with **zero console/page errors** — the dynamic
  `ActivityHrChart` import resolves cleanly and the chart-js registration doesn't throw. The chart
  section itself correctly stayed hidden (the pre-existing `zoneReadings.length >= 2` guard, same
  one `ZoneBreakdown` already used) since no live HR samples exist in this sandbox — the intended
  degradation, not a bug.
- **Not verified:** the chart's actual visual rendering with real HR data and real phase bands —
  live HR requires a real Oura ring/Polar strap over Bluetooth, which cannot be exercised from this
  sandbox (per the plan's own verification note). The plugin's pixel-mapping *logic* is unit
  tested directly instead, per the plan's suggested fallback ("the chart can still be exercised
  with synthetic sample data in a unit test").

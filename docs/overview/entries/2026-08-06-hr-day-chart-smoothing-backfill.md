# 2026-08-06 — Smoother HR-today chart line + opt-in estimated backfill across gaps

**Domain:** heart-rate — v1.266.10, JS-only (no APK rebuild)

## The report

Q-92 (owner UI-bug batch): the home screen's "HEART RATE · TODAY" chart line is too
granular/jagged; wants it bucketed/smoother, plus an opt-in "backfill" that draws an estimated
line across missing-data gaps, visually distinguished from real data.

## The fix

- `components/health/hr-day-chart.tsx`: the bucket width was already tunable math
  (`bucketAverage`, shared with the done-screen recovery chart and the live workout sparkline)
  but hardcoded at 5 minutes. Promoted it to a `bucketMinutes` prop, defaulted to 10 — doubling
  the bucket width without changing the underlying formula.
- `components/health/hr-day-chart-gaps.ts`: added `interpolateGaps(points, gapMin, maxGapMin)`,
  a pure sibling to the existing `withGapBreaks`. It produces a **separate** point series that
  linearly bridges real coverage gaps between 20 minutes and 2 hours — gaps larger than that stay
  an honest break in this series too, since a straight line across many hours of missing data
  reads as more confident than the data supports. `withGapBreaks` itself is untouched: the real
  line still renders an honest break at every gap, exactly as before.
- The estimated series renders as a second chart.js dataset — dashed (`borderDash`), straight
  segments (`tension: 0`, vs. the real line's `0.4`), no fill, and a scheme-aware teal color
  distinct from the sleep/workout shading and the real HR line — with a legend entry ("Estimated")
  that only appears when a bridged segment exists.
- `showBackfill` is opt-in per the existing "never fake-interpolate by default" design — wired on
  only at the reported call site, the home screen's HR widget (`home-card-widget.tsx`). The other
  three `HrDayChart` consumers (`/health/heart-rate`, the Heart & Recovery card, the day-review
  sheet) get the smoother bucket width but keep rendering exactly as before otherwise.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` missing-module error
confirmed via `git stash` diff). Full suite: 401 files / 3,180 tests green, including 4 new unit
tests for `interpolateGaps` (bridges a bridgeable gap with a two-point segment isolated by a
trailing NaN; leaves sub-threshold gaps alone; leaves over-`maxGapMin` gaps alone; isolates two
separate bridged runs from each other across an unbridged one).

Ran `pnpm dev` against the local DB, seeded real `oura_heartrate` rows with a genuine ~45-minute
gap, and screenshotted the chart (temporarily flipping `showBackfill` on at the
`/health/heart-rate` detail page for the check, then reverting — no product change there) in both
light and dark themes: the real line renders smoother, the dashed teal "Estimated" segment bridges
exactly the gap and nowhere else, and the legend entry appears only when a bridge exists.

**Not exercised:** the home-screen widget itself (`home-card-widget.tsx`'s `card_hrChartWidget`)
is opt-in via a `localStorage` preference (`ta_ss_cards`) that didn't take effect in a headless
check this session — verified the identical shared `HrDayChart` component interactively instead
(same code path, confirmed correct above) and confirmed the `showBackfill` prop is wired at that
call site by code review. No on-device (S25) confirmation of chart legibility/contrast at native
DPI — this project has no component-test/Playwright infra wired into CI.

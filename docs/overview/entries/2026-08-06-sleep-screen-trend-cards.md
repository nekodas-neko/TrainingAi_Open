# 2026-08-06 — Sleep screen gets phase-hours/bedtime/wake-time trends + skin temperature

**Domain:** sleep — v1.267.1, JS-only (no APK rebuild)

## The report

Q-90 (owner UI-bug batch): expand the sleep detail screen — a chart that can toggle between
metrics or combine several, skin temperature shown somewhere, and more 14-day trend charts (phase
hours per night, bedtime, wake-up time) matching the existing "Sleep Score — 14 days" chart.

## The interaction decision

The plan flagged one real ambiguity: "toggle between, or combine" needed a concrete choice before
building. Picked **toggle** — a segmented control (the app's existing `SegmentedTabs` pill-tab
primitive, used ~17× elsewhere) over one shared chart area, switching between Sleep Stages /
Bedtime / Wake Time — over three permanently-stacked cards, since toggle was one of the two
options the owner explicitly named and keeps the screen from growing a new always-visible card
every time a future view gets added. Skin temperature reads as its own separate ask in the
report's phrasing ("shown somewhere on this screen") rather than part of the toggle group, so it's
a standalone always-visible card using the existing `TrendSparkline` component, not part of the
segmented control.

## The fix

- `app/api/health/trends/route.ts`: added `temperatureDeviation` to `HealthTrendDay`, sourced from
  `oura.temperatureDeviation` (already fetched by this route via `repo.getOuraDaily()` for the
  Readiness screen — no new query).
- `components/health/trend-sparkline.tsx`: added `"temperatureDeviation"` to the `Field` union.
- `components/health/health-score-detail.tsx`: `extraCards` now also receives the 14-day `trends`
  array as an optional third argument — additive, so the two other consumers (Readiness, Activity)
  are unaffected.
- New components: `sleep-phase-trend-card.tsx` (stacked bar, reusing the canonical `STAGE_COLOR`
  palette from `hypnogram.ts` rather than a second copy), `sleep-timing-trend-card.tsx` +
  `sleep-timing-trend-utils.ts` (bedtime/wake-time line charts — pure logic extracted to a `.ts`
  file so it's unit-testable without pulling chart.js/JSX into the test transform, same reasoning
  as the existing `hr-day-chart-gaps.ts` pattern), and `sleep-trend-toggle-card.tsx` (the
  segmented-control wrapper). Both new chart components are wrapped in a `-lazy.tsx` dynamic
  import, matching every other chart.js widget on this screen.
- Bedtime plots on the noon-shifted axis (`minutesFromNoon`, already used by this same screen's
  consistency card) so an 11:30pm→12:15am transition reads as 45 minutes, not a ~23-hour cliff.
  Wake time doesn't share that problem (clusters mid-morning) so it plots on plain
  minutes-since-midnight. Both convert back to a clock-time label for axis ticks and tooltips.
- `sleep-content.tsx` reshapes the 30 days of `sleepRows` it already had in state (no new fetch)
  into the last 14 nights, oldest→newest, for the new cards.

## A bug caught during visual verification

The stacked bar chart's legend didn't render at all — chart.js requires explicitly registering the
`Legend` plugin (like `Tooltip`), and it was missing from the `ChartJS.register()` call. Caught by
actually looking at a screenshot rather than trusting a clean typecheck/lint/test pass; fixed by
adding `Legend` to the registration and bumping the chart's fixed height from 140px to 170px so the
legend row has room.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` error confirmed via
`git stash` diff). Full suite: 402 files / 3,188 tests green, including 8 new unit tests for the
bedtime/wake-time noon-shift math (`sleep-timing-trend-utils.test.ts`) — covering the exact
midnight-wrap trap this codebase has hit before (see the sleep domain's bedtime-vs-sleep trends
work).

Ran `pnpm dev` against the local DB, seeded 13 real nights of varied bedtimes/phase-hours/skin
temperature, and screenshotted the full sleep screen in both themes: the phase-hours stacked bar
(with its now-fixed legend), the bedtime and wake-time line charts (correct clock-time axis labels,
no midnight-wrap artefact), and the skin-temperature sparkline all render correctly, and switching
the segmented control swaps the chart area live. Also verified the "fewer than 14 nights" case with
only 2 seeded nights — degrades to a 2-bar/2-point chart, no crash, no error in the browser console.
Restored the local dev DB's original 7-night seed data afterward (verified against
`scripts/local-db/seed.sql`'s exact insert logic) and cleared all other test-only rows.

**Not exercised:** on-device (S25) chart rendering/contrast at native DPI — this project has no
component-test/Playwright infra wired into CI, so this was a manual check, not a regression guard.

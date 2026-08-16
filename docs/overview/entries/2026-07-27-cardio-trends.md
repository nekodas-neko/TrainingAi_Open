# 2026-07-27 — Cardio trends surface (cardio batch item 1)

Branch: `feat/cardio-trends` · v1.216.0

## Why

Fourth item in the cardio/running redesign batch — see
`docs/superpowers/specs/2026-07-26-cardio-system-spec.md` (spec decision D-6) and
`docs/superpowers/plans/2026-07-27-cardio-trends.md`. The session-visuals item
(`docs/overview/entries/2026-07-27-cardio-session-visuals.md`) covered per-session detail; this
item covers the multi-week trends surface, following the same view-picker + `cachedFetch` pattern
already established by `components/health/trends-section.tsx`/`trend-chart.tsx`.

## What shipped

- **`lib/date-utils.ts`** — `weekStartForDay(day)`, the same Mon-Sun week-bucketing logic
  `startOfWeekInTz` already uses for "now", generalized to an arbitrary historical date string.
- **`lib/health/cardio-trends.ts`** — three pure aggregation functions: `bucketZoneMinutesByWeek`
  (sums `getZoneMinutesRange` day-rows into weekly totals), `buildEfficiencyCurve` and
  `buildCadenceTrend` (filter + sort `activity_logs` rows with the needed fields present). 5 unit
  tests.
- **`app/api/cardio-trends/route.ts`** — new aggregation route, mirroring `/api/cardio-week`'s
  auth/rate-limit/tz boilerplate and reusing its exact `resolveHrProfile` call for
  `getZoneMinutesRange`'s profile argument.
- **`components/cardio/zone-stack-chart.tsx`**, **`efficiency-chart.tsx`**,
  **`cadence-trend-chart.tsx`** — three chart.js components (stacked bar, dual-axis line, plain
  bar), all colours through `resolveColor`.
- **`components/cardio/trends-section.tsx`** — orchestrator with a three-pill view picker, added to
  the bottom of `cardio-content.tsx`.

## Deferred, not silently dropped

Spec D-6 lists five trend views. Two are **not** included: "distance/pace vs anchor" and "PR
history" both depend on the baseline-anchor system, which is backlog item "Density-progression
engine + anchors" (`feat/cardio-progression`) — not yet planned or built. Tracked in
`docs/implementation-backlog.md`.

## Verification

- `tsc` clean · lint 0 errors (same pre-existing warnings) · **2096 tests passing** (5 new: 4
  `weekStartForDay` + a fix for a caught `no-restricted-syntax` lint violation on the first draft's
  `.toISOString().slice()` — switched to `formatInTimeZone`, matching `startOfWeekInTz`'s existing
  pattern) · `check-reconcile`/`check-push-mutations`: OK · isolated `next build` clean.
- **Dev-server verification with real data.** `/api/cardio-trends` returned real data from the
  synthetic activity log inserted during the session-visuals item's verification pass (still
  present in the same local Postgres instance) — non-empty `weeklyZoneStacks`, `efficiencyCurve`,
  and `cadenceTrend` for the current week.
- **Dev-server + Playwright.** Signed in, opened `/cardio`, scrolled to the new Trends card:
  confirmed the "Zone minutes" stacked bar chart renders with real per-zone colours; tapped
  "Efficiency" and confirmed the dual-axis HR/pace line chart renders (reversed pace axis, faster
  reads as up, matching the pace-bar-chart convention from the sibling session-visuals item); tapped
  "Cadence" and confirmed the bar chart renders. Toggled dark theme and confirmed gridlines/axis
  text stay visible (not invisible-white-on-black) across all three views. No console/page errors.

## Not verified

- **Multiple weeks of real data.** The seed only had one synthetic activity in one week, so the
  zone-stack chart's cross-week rendering (multiple stacked bars side by side) was only confirmed
  structurally (correct chart.js config), not visually with >1 week of non-zero data.
- **On-device (S25 APK).** Same caveat as every prior cardio-hub surface.

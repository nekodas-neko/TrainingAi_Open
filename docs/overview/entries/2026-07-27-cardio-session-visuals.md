# 2026-07-27 — Cardio session visuals (cardio batch item 1)

Branch: `feat/cardio-session-visuals` · v1.214.0

## Why

Third item in the cardio/running redesign batch — see
`docs/superpowers/specs/2026-07-26-cardio-system-spec.md` (spec decision D-6) and
`docs/superpowers/plans/2026-07-27-cardio-session-visuals.md`. `activity-metrics.ts` has computed
`bestEfforts` and `paceSeries` since the GPS-tracking feature shipped, but neither was ever rendered
anywhere — this item closes that gap and adds the spec's "hero interactive chart".

## What shipped

- **`lib/activity/scrub.ts`** — `estimateDistanceKmAtTime(paceSeries, tSec)` integrates the
  time-bucketed pace series to a cumulative distance, and `pointAtDistanceKm(points, targetKm)` walks
  the decoded route polyline to the matching lat/lng via linear interpolation. Together they let a
  scrub position on the (time-based) hero chart drive a marker on the (distance-based) route map with
  no new stored data. `haversineDistanceKm` (`lib/activity/activity-metrics.ts`) was widened to accept
  any `{lat, lng}` pair instead of requiring a full `RoutePoint` — the function never used the
  timestamp/elevation fields, so this is a pure type widening, not a behaviour change. 8 unit tests.
- **`components/activity/hero-activity-chart.tsx`** — dual-axis HR/pace line chart (chart.js), pointer
  move over the canvas calls back with the scrubbed elapsed seconds; `ActivityDetailSheet` turns that
  into a map marker position. Replaces the plain `ActivityHrChart` only for GPS sessions with a
  `paceSeries` — non-distance activities (yoga, HIIT, stretch) keep the plain HR-only chart.
- **`components/activity/pace-bar-chart.tsx`** — per-km pace bars (reversed axis so faster = taller)
  plus the fastest-1km/5km callouts from `bestEfforts` — computed and stored since the feature shipped,
  never rendered until now.
- **`components/activity/zone-donut-chart.tsx`** — a compact donut beside the existing
  `ZoneBreakdown` bar-list, from the exact same `zoneBreakdownFromReadings` computation (no second zone
  formula).
- **`components/activity/activity-route-map.tsx`** — added an optional `activePoint` prop rendering a
  third, brand-coloured marker.
- **`components/activity/activity-hr-chart.tsx`** — fixed a pre-existing canvas-colour hazard (raw
  `rgba(255,255,255,0.04)` gridlines, invisible in light theme) by routing grid/tick colours through
  `resolveColor`, matching the pattern already established in `components/health/trend-chart.tsx`.
  Touched because Task 4 is a near-duplicate of this chart's HR line and shipping a second
  light-mode-broken chart next to a freshly-fixed one would have been an inconsistency worth avoiding.
- **`components/activity/activity-detail-sheet.tsx`** — wires all of the above into the existing
  per-session detail sheet; the splits list became a bordered dense table instead of a plain list.

## Explicitly out of scope (documented, not silently dropped)

A full elevation-profile-vs-distance chart is **not** included. `encodeRoute` (Google polyline format)
only stores lat/lng — the per-point `ele` field is dropped before persistence, and only the aggregate
gain/loss numbers (already shown as two stat tiles) survive. A real profile needs a new stored
per-point series (mirroring how `paceSeries` was added originally) plus a migration and
`pushMutations`/local-store/reconcile sync-mirroring update — schema-touching work, not a visual-only
wiring pass. Tracked as its own new backlog item (`feat/cardio-elevation-profile`) in
`docs/implementation-backlog.md`.

## Verification

- `tsc` clean · lint 0 new errors (1 pre-existing `react-hooks/exhaustive-deps` warning, unrelated to
  this diff) · **2083 tests passing** (8 new) · `check-reconcile`/`check-push-mutations`: OK (this plan
  touches no sync/local-store files) · isolated `next build` clean (`.next` wiped first, dev server
  stopped first, per the established workaround).
- **Dev-server + Playwright, with real seed data.** The local seed had zero `activity_logs` rows, so a
  synthetic GPS-tracked "Morning Run" (route polyline, splits, best efforts, pace series, cadence,
  elevation) and matching `oura_heartrate` readings were inserted directly into the local Postgres
  instance for this verification pass only (not committed, not part of the app's seed script).
  Confirmed: the hero chart renders both HR (red) and pace (brand colour, reversed axis) lines; moving
  the pointer across the hero chart's canvas changes the Leaflet marker count from 3→4 (start + end +
  route line + the new active-point marker) and back to 3 on pointer-leave, confirming the scrub → map
  sync works end-to-end, not just in the unit tests; the pace bar chart and both best-effort callouts
  render; the zone donut renders beside the existing bar-list, colour-matched; the splits table renders
  as a bordered list. Also inserted a non-GPS "Evening Yoga" log to confirm the fallback path (plain
  `ActivityHrChart`, no hero chart, no pace chart, no crash) still works. Checked both light and dark
  theme on the hero chart — gridlines and axis text are visible (not invisible-white-on-white) in both.
  No console/page errors in either pass.

## Not verified

- **On-device (S25 APK).** The `touch-none` class on the hero chart's wrapper is meant to stop a
  vertical touch-drag from scrolling the sheet while scrubbing — this is untested on a real Samsung
  WebView touch gesture; the sandbox only exercises desktop Chromium pointer events via Playwright.
  Flagging per the Canonical Runtime policy.
- **Populated real-world data.** All verification used synthetic seed rows inserted for this session
  only; the charts have not been exercised against a real multi-week history of actual GPS runs.

## 2026-07-27 — Elevation profile chart

Implements the "Elevation profile chart" cardio backlog item
(`docs/superpowers/plans/2026-07-27-cardio-elevation-profile.md`), the last item deferred from the
now-shipped per-session visual system. Completes the running-system backlog sweep — everything
plannable is now shipped or explicitly deferred (D-7/D-8 plateau handling, gated on real
push-session usage history).

### What shipped
- **`computeElevationProfile`** (`lib/activity/activity-metrics.ts`) — a distance-bucketed
  (default 0.1km) elevation series, mirroring `computePaceSeries`'s bucketing shape but keyed on
  cumulative distance instead of elapsed time. Points without elevation data are skipped, matching
  the existing `computeElevationChange`'s null-skipping behavior.
- **`ActivityLog.elevationProfile`** — a new field threaded through every layer the existing
  `paceSeries` field already goes through: the Postgres column (migration 151), the repository
  type, the Zod validation schema, the adapter's read/write mapping, `activity-store.ts`'s
  `finish()`, all three `done-activity-screen.tsx` save payloads (local SQLite write, outbox
  mutation, web-fallback fetch), and the offline sync chain (local SQLite table via
  `RECONCILE_COLUMNS`, pull-delta mapping). The `pushMutations` branch itself needed no change —
  confirmed generic/schema-driven via direct code reading before writing the plan.
- **`ElevationProfileChart`** — a new `chart.js`/`react-chartjs-2` line chart on the activity
  detail sheet, mirroring `PaceBarChart`'s visual language (token-resolved colors, `h-28` sizing),
  rendered whenever a log's `elevationProfile` has more than one point.
- **Found and fixed a gap the plan's research missed:** `components/guided-walk/walk-summary.tsx`
  also constructs a `LocalActivityLog` object directly (a second, independent write site the
  original `paceSeries`-tracing research agent didn't surface) — TypeScript caught this immediately
  once `elevationProfile` became a required field, and it was fixed in the same commit as the other
  `done-activity-screen.tsx` write-site changes.

### Verification
- 3 new unit tests for `computeElevationProfile` — full suite green (2206 tests).
- Manual verification: seeded an `activity_logs` row via `psql` with a 5-point elevation profile
  (10→25→15→35→20m across 2km), confirmed via Playwright screenshot that the "Elevation" chart
  renders correctly on the activity detail sheet (`/health` → Training tab → tap the activity),
  below the existing gain/loss stat tiles and above the pace-per-km bar chart.
- **Not verified:** on-device (APK) for the local-SQLite/offline-sync path — the web sandbox only
  exercises the web-fallback write path and a manually-seeded read path, never the native SQLite
  local-first write→sync→pull round-trip. Real GPS elevation data was also never exercised — the
  dev sandbox has no real device GPS, so the chart was only verified against a hand-seeded row.

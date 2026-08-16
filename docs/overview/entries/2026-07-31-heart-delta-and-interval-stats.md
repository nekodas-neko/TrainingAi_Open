# 2026-07-31 — Compact heart-card delta; new by-run-type and fast/slow-block stats cards

Branch: `fix/heart-delta-and-interval-stats` · v1.249.0

Owner follow-up on the previous session's PR #957 (running carousel desync, active-run safe
areas, 30-day heart stats, interval-walk carousel), from two more screenshots: the heart card's
"+/-N vs last mo." line should be a compact colored number next to the stat instead, and both the
Interval walk and Running screens should show historical stats — avg pace/distance/HR for
fast/slow walk blocks, and the same broken out by run type (tempo/easy/long/etc.).

## Changes

1. **Heart-card delta styling** (`components/cardio/heart-profile-card.tsx`) — replaced the
   `DeltaLabel`'s separate "+/-N vs last mo." line with a compact `+N`/`-N` rendered inline next
   to the stat value, colored via `var(--destructive)` (increase) / `var(--accent-green)`
   (decrease) — no `--accent-red` token exists in the theme, `--destructive` is the project's red.
2. **Walk fast/slow block stats** — researched first (see "Data model findings" below): the
   `activity_logs.segments` column (migration 161) already stores every guided walk's per-block
   kind/pace/distance/HR, so this needed no schema change.
   - `lib/walk/segment-stats.ts` — added `avgDistanceKm` to `KindAggregate` (mean distance per
     block) alongside the existing `totalDistanceKm` (sum for one walk's own summary card) —
     the historical card needs a per-block average, not a lifetime sum. `aggregateSegmentsByKind`
     itself needed no change: it has no notion of which walk a segment came from, so a flattened
     list across many walks aggregates correctly already.
   - `app/api/guided-walk/segment-stats/route.ts` (new) — `listActivityLogs` over a ~3-year
     window (mirrors `running-bests`' lookback), filters to `activityType: 'walk'` with
     `segments` present, flattens, and calls `aggregateSegmentsByKind`.
   - `components/guided-walk/walk-segment-stats-card.tsx` (new) — "Your fast / slow blocks" card,
     two columns (pace / distance / HR each), hidden when there's no data yet.
   - Wired into `components/guided-walk/walk-config.tsx` (the Interval walk config screen) via
     the same `cachedFetch`/`readCacheSync` non-today pattern `running-bests` uses.
3. **Run stats by type** — the owner chose the "plan-prescribed runs only, no migration" option
   after being shown the tradeoff (a run's type is only recorded via `prescribed_runs.runType`,
   populated only when a run is started from the Running screen's carousel/prescription; a
   freeform run has no type stored anywhere and can't be included without a new column).
   - `packages/shared/src/running/run-type-stats.ts` (new) — `computeRunTypeStats`, a pure
     aggregator mirroring `aggregateSegmentsByKind`'s shape, grouping by the five known
     `RunType`s and dropping any other/legacy `runType` string.
   - `app/api/running-plan/run-type-stats/route.ts` (new) — joins `getPrescribedRuns` (filtered
     `status: 'completed'`, has `activityLogId`) against `listActivityLogs` over the same ~3-year
     window to pull each completed run's distance/pace/HR.
   - `components/running/run-type-stats-card.tsx` (new) — "By run type" card, one row per type
     with data, hidden entirely if no plan-prescribed run has ever completed.
   - `components/running/run-type-carousel.tsx` now exports `TYPE_LABEL` (was module-local) so
     both cards share one label source instead of a second copy.
   - Wired into `components/running/running-plan-content.tsx` next to `RunningBestsCard`.
4. Two new TTL constants (`RUN_TYPE_STATS_TTL`, `WALK_SEGMENT_STATS_TTL`, both `TTL_LONG`) added
   to `packages/shared/src/cache-ttl.ts`, mirroring `RUNNING_BESTS_TTL`'s rationale (changes only
   when a new walk/run completes). Neither key is registered in a cache-groups invalidation group
   — same as `running-bests` today, which relies on the passive TTL rather than write-time
   invalidation; followed the existing sibling's precedent rather than introducing new wiring.

## Data model findings (from a scoping investigation before implementing)

- Guided walk: **fully feasible with existing data**, no migration — `activity_logs.segments`
  (migration 161) already has per-block kind/pace/distance/HR for every walk saved since that
  column shipped. Older walk logs predate it and simply have `segments = null`.
- Runs by type: **partial coverage without a migration** — `prescribed_runs.runType` only exists
  for runs completed via the running-plan flow (`components/running/running-plan-content.tsx`'s
  `onStart` → `linkPrescribedRun`). A run logged outside that flow has no type anywhere. Full
  coverage would need a `run_type` column directly on `activity_logs`, populated at save time —
  scoped out for this PR per the owner's choice above; noted here in case "all runs, not just
  plan-prescribed" comes up again.

## Verified

- `tsc --noEmit`, `pnpm lint`, and the custom-rule scripts (`check-push-mutations`,
  `check-reconcile`) all clean.
- Added/updated unit tests: `lib/walk/__tests__/segment-stats.test.ts` (new `avgDistanceKm`
  assertions) and a new `packages/shared/src/running/__tests__/run-type-stats.test.ts` (4 cases:
  averaging, null-skipping, unknown-type dropping, empty input) — all pass, plus the full
  `lib/walk`, `packages/shared/src/running`, `components/cardio`, `components/running`,
  `components/guided-walk`, `app/api/guided-walk`, `app/api/running-plan` suites (93 tests, 0
  failures).
- Ran against `pnpm dev` + local Postgres: seeded synthetic HR history (60 days, two different
  baselines) to visually confirm the compact colored delta renders correctly (`-10`/`-13` green,
  `+20` red, inline next to each stat) — screenshot matched the requested layout exactly. Seeded a
  synthetic walk with 4 segments and two completed prescribed runs (tempo + easy) to confirm both
  new cards render with correct math (hand-verified the avg pace/distance/HR against the seeded
  segment values) and correctly disappear when there's no data. All synthetic seed rows deleted
  afterward.

## Not verified

- **The S25 APK.** No native/safe-area/gesture surface touched by this change, but the actual
  on-device render of the two new cards and the restyled delta hasn't been looked at.
- **Real multi-walk / multi-run history.** The local seed only had synthetic single-instance data
  per type; the averaging math is unit-tested and was hand-verified once against seeded values,
  but a real user's larger history (many runs of the same type, walks with missing GPS/HR on some
  segments) hasn't been exercised.

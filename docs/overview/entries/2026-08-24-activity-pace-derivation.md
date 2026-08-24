# 2026-08-24 — activity-log pace derived server-side (Q-307)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · one migration (210), no APK.

`avg_pace_sec_per_km` was read straight off the column and never derived — every writer
(`exercise-review-sheet.tsx`) sent it as an explicit `null`, matching Q-230's `caloriesBurned`
before that got fixed. 32 of 39 activity logs with both `distance_km` and `duration_min` had no
pace, so the efficiency chart had gaps on 85% of distance-bearing logs.

## What shipped

- `saveActivityLog` (`lib/data/postgres/adapter.ts`) now derives `avgPaceSecPerKm` from
  `durationMin * 60 / distanceKm` when the caller doesn't supply one — same shape and same call
  site as the existing `caloriesBurned` derivation right above it, so the web route and the
  `pushMutations` outbox branch both get it for free (they already call the one shared function).
- Migration 210 backfills the rows written before this existed: an idempotent `UPDATE … WHERE
  avg_pace_sec_per_km IS NULL AND duration_min IS NOT NULL AND distance_km IS NOT NULL AND
  distance_km > 0`. Never touches a row that already has a pace — client-supplied or previously
  derived values stand.
- `lib/data/postgres/__tests__/activity-log-pace.test.ts`, five cases mirroring
  `activity-log-calories.test.ts`'s shape: fills a missing value, never overwrites a supplied one,
  stays null with either input missing, stays null on a zero-distance guard.

## Verified

- New test file: 5/5 passing against the local Postgres.
- Full suite: 123 test files, 761 tests, all green.
- Migration round-tripped against three hand-inserted rows on the local DB — one filled (30 min /
  3 km → 600 sec/km), one left alone (already had 555), one left null (no distance). Rows deleted
  after.
- `pnpm check:rules` — 55 of 55 (the migration pointer bump is the same PR).
- `tsc --noEmit` clean.

**Not exercised:** production — the backfill has not run against the real 46-row table this entry
was measured against; it will apply automatically on the next `ensureSchema()` cold start after
this deploys, same as every other migration. Nothing device, native, safe-area or offline is
touched — the derivation is server-side arithmetic on values already being written.

## 2026-07-29 — Guided walk: recorded per-segment stats, HR-zone map, fast/slow averages

Owner-directed follow-up after seeing the shipped GPS/pace and HR-chart work: the walk-complete
screen still only showed ephemeral per-interval numbers that were thrown away on save, and asked
for the same granularity a workout's `set_logs` get per set — "the guided walk slow and fast time
will have slow + pace + HR start + distance etc, so that it can be compared and averaged in the
future," plus a route map and fast/slow averages on the summary screen itself.

### What shipped

**Recorded data (new `activity_logs.segments` JSONB column, migration 161).** Mirrors the existing
`splits`/`paceSeries`/`elevationProfile` JSONB-array-on-`activity_logs` pattern (migration 151)
rather than a new relational table/sync domain — one more field through the exact write paths those
already go through. Each walk now stores one entry per plan segment (including warmup/cooldown, not
just fast/slow): `{index, setNumber, kind, startSec, endSec, avgHr, maxHr, hrAtStart,
avgPaceSecPerKm, distanceKm, avgCadenceSpm}`. A segment with no sensor coverage for its window still
gets a row — with all-null stat fields — rather than being silently omitted, so "5 sets, 2 had HR
data" stays visible in the record itself.

- **`lib/walk/segment-stats.ts`** — `computeWalkSegmentStats` (reuses the existing `samplesInWindow`
  helper for HR, GPS, *and* cadence windowing) and `aggregateSegmentsByKind` (fast-vs-slow roll-up:
  avg HR, avg pace, total distance, segment count — skips null-stat segments in the average instead
  of treating them as zero). Both pure and unit tested (10 tests: windowing correctness cross-checked
  against the already-tested `computeTotalDistanceKm`/`computeAvgPaceSecPerKm`, empty-window nulls,
  aggregate rollup arithmetic, null-skipping).
- Threaded through every layer `elevationProfile` already goes through: Postgres migration + schema,
  the shared `ActivityLogBody` Zod schema (used by both the web route and `pushMutations`), the
  repository adapter (`saveActivityLog`/`rowToActivityLog`), local SQLite (row mapper,
  `upsertActivityLog`, `applyDelta`'s pull-insert), and `RECONCILE_COLUMNS` (additive, no version
  bump, per the established Batch-F pattern — a partial local-upgrade can't leave this column
  missing).
- `walk-summary.tsx`'s ad-hoc `perSegment` calc (built for the live per-interval display only, never
  saved) is now literally `computeWalkSegmentStats` — one computation powers both the display and
  what gets persisted, instead of two copies that could drift.

**Walk-complete screen enrichment:**
- **HR-zone-colored route map** — reuses `buildRouteZoneSegments` (shipped for regular activities,
  #878) + `ActivityRouteMap`'s `zoneSegments` prop unchanged. A guided walk already has the real
  epoch-ms `startedAtMs` the whole time, so this needed no `date`+`"HH:MM"` reconstruction the way
  the regular-activity call site does — pace series and HR readings correlate to it directly. Falls
  back to a flat single-color line when there isn't enough data to correlate (no HR profile, no
  readings), same graceful-degradation rule the existing helper already encodes.
- **Fast/slow average cards** — "Fast avg (N sets)" / "Slow avg (N sets)" showing avg pace, avg HR,
  and total distance, from `aggregateSegmentsByKind`. Hidden entirely when neither kind has any
  segments (shouldn't happen for a real walk, but matches the same-shape guard used elsewhere).

### Verification
- Full gate: lint (0 errors), `tsc --noEmit` (clean), full test suite (2587 passed; the one
  `claude-ro-readonly-role` failure is this sandbox's local `DATABASE_URL` format issue documented
  in the prior two guided-walk entries — unrelated file, unaffected by this diff).
- Local Postgres migration applied cleanly (`\d activity_logs` confirms the `segments jsonb` column).
- `node scripts/check-reconcile.js` — RECONCILE_TABLES/RECONCILE_COLUMNS completeness confirmed
  (117 columns tracked, including the new one). `node scripts/check-push-mutations.js` — clean (no
  direct-SQL touch in `pushMutations`, it still only calls the shared `saveActivityLog`).
- **Real end-to-end dev-server Playwright verification**: completed a guided walk with mocked
  `navigator.geolocation` movement, confirmed `POST /api/activity-logs` returned **201** with a real
  10-entry `segments` array in the request body (the segment with GPS coverage carried real
  `avgPaceSecPerKm`/`distanceKm`, the rest correctly null since the walk was ended early). Screenshot
  confirmed the route map rendered (flat-color fallback, since this sandbox has no real HR data to
  color by), the "Fast avg"/"Slow avg" cards rendered with real numbers for the segment that had
  data and honest dashes for the one that didn't, and the existing per-interval list kept working.
- **Not verified:** real HR-zone-colored segments (needs a real Oura ring/Polar strap — this
  sandbox's Playwright walk had zero live HR samples, so `zoneSegments` correctly fell back to flat
  color, but the actual per-run zone-color painting was never exercised with real data) and the
  native offline-first local-SQLite write/pull-sync round-trip for the new column (`getLocalStore`
  returns null in the web sandbox, so only the web-fallback save path was exercised). Flagged in a
  new Known Issues row in `projectOverview.md`.

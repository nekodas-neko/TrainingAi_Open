# 2026-09-25 — RV-182 ②: one number per epoch, not the whole anchor log

**Branch:** `rv182-anchor-offset-sql` · **Lane A**

`getOuraClockAnchors` was **2,190 calls × 9,736 rows, 106 s, 9.4% of all database time**, and every
caller but one reduced those rows to a single scalar per epoch and threw the rest away.
`robustOffsetMs` takes the 10th-percentile lag — an order statistic — so the database can produce it
directly.

`getOuraClockOffsets` returns one row per epoch. Five adapter read paths that only convert
timestamps now take it (`getWorkoutSensorProbe`, `getSleepCoverageEnd`, `getDaytimeTagCoverage`,
`getOuraDaytimeSignals`, `getOuraBatteryEvents`). The rollup and three others keep the series,
because they genuinely need the observations — `run.ts` reads `anchor.anchorDs` for its watermark.

## Two corrections, one of them to my own first attempt

**The entry's attribution was wrong.** It read the cost as one number across three functions and
proposed `ORDER BY epoch DESC, anchor_ds DESC LIMIT 1` plus an index on `(user_id, anchor_utc DESC)`.
Measured separately on 2026-09-25:

| function | calls | mean | total | share |
|---|---|---|---|---|
| `getOuraClockAnchors` (full series) | 2,190 | 48.45 ms | **106 s** | **9.4%** |
| `getOuraClockEpochHead` (the `GROUP BY`) | 4,942 | 1.80 ms | 9 s | 0.8% |
| `getNewestOuraClockAnchorByUtc` (unindexed `anchor_utc`) | 4,942 | 1.71 ms | 8 s | 0.8% |

The two the fix targeted are already cheap. It would have bought at most 1.6%, left the 9.4%
untouched, and — applied literally — undone LA-139, which moved four call sites onto the full series
that same day because a single newest anchor was the wrong offset.

**And my own first formulation was a regression.** Expressing the order statistic with
`row_number() OVER (PARTITION BY epoch ORDER BY lag)` measured **53–67 ms** against the series
read's ~48 ms, because the window sorts all 12,591 rows. Counting per epoch first and taking a
top-N with `OFFSET` is **19–27 ms** warm. Both return the identical offset; only one is worth
shipping. That is the second time in two days a "replace the fetch with an aggregate" instinct has
had to be measured rather than assumed — RV-181 was the first.

## Getting the rank right

`floor(n * LAG_PERCENTILE)`, zero-based, matching `Math.floor(lags.length * LAG_PERCENTILE)` — **not
`percentile_disc`**, whose rank rule disagrees at small n. `LAG_PERCENTILE` is now exported from
`clock.ts` and interpolated into the SQL, so one constant serves both languages.

Two details that cost a run each and are worth stating:

- **`${LAG_PERCENTILE}::float8` is load-bearing.** Bound beside a bigint `count(*)`, the parameter is
  inferred as bigint and Postgres rejects `0.1` outright. The cast also makes it the same IEEE
  double multiply as the JS, so the two floors cannot part company.
- **`floor(extract(epoch FROM anchor_utc) * 1000)`** truncates to whole milliseconds, because the JS
  path reads `new Date(anchor_utc).getTime()`, which does the same.

## A defect the test found in my own helper

`offsetsFromAnchors` first returned `memoFor(anchors)` directly. That memo fills **lazily**, as
`offsetForEpoch` is asked — so it hands back an empty map, and the offset-based resolvers read
`undefined` and answer null. Every equivalence case failed on the JS side while the SQL was right.
It now populates eagerly, one entry per epoch present, which is the shape the database returns.

## Verification

- `clock-offset-sql-equivalence.test.ts` — 7 cases running **both** paths over the same anchors: no
  anchors, one anchor, n straddling every rank boundary to 31, a tie at the chosen rank, several
  epochs at once, one epoch with a single anchor beside one with many, and another user's rows
  present.
- **Mutation pass:** rank off by one, `ceil` for `floor`, lag sign flipped, `ORDER BY … DESC`, and
  the epoch predicate dropped — all five killed. An equivalent control (equality operands swapped)
  survives. **Two further "controls" I wrote were themselves broken** — both alias renames left one
  reference behind, making them syntax errors rather than rewrites, which is a lesson about writing
  controls rather than about this code.
- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1055 test files / 9825 tests passed**,
  Custom Rules 78 of 78, build green.
- **`pnpm dev` against 600 seeded anchors**, logged in: `/api/oura-ble/daytime-coverage` returns
  `hasAnchor: true` — the epoch resolved through the new path — plus `/api/sleep-sessions`,
  `/api/body-battery`, `/api/training-stress` and `/api/oura-ble/battery-analytics` all 200, and
  `/api/oura-ble/workout-sensors` reaching its "no completed workout" branch past the anchor
  resolution. No errors in the server log.

**Not exercised:** no device, native or safe-area surface. The production timings are reads against
the live database, not a deployed run of this code, and **the saving is not yet confirmed in
production** — `pg_stat_statements` counters are cumulative, so the drop will show as the
series-read share falls over the coming days rather than immediately.

## What is left

RV-182 ③, the rollup's delete-and-reinsert of ~880 HR rows per pass (535k deletes against 137k live
rows, `oura_heartrate_pkey` with 0 scans). And the anchor table still grows 150–300 rows a day: this
change stops most readers caring, but the seven remaining series callers still pay for it, so
thinning the inserts is worth its own look — noting it would move the offset value, where this
change provably does not.

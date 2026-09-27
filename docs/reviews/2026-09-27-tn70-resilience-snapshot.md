# TN-70 — the 30 published resilience rows, captured before any backfill overwrites them

**Captured 2026-09-27 (Lane A), read-only from production via `/api/admin/db-query`.**

## Why this file exists

TN-70's prescribed next step is a wide rollup pass over history, to fill the
`night_hrv_baseline_ms` column that LA-140 gave a writer on 2026-09-25. **That pass would destroy
the evidence TN-70 exists to explain**, and nothing in the entry said so.

`upsertDailyDerived` resolves every column as `COALESCE(excluded.<col>, oura_daily_derived.<col>)`
(`lib/data/postgres/slices/oura.ts`), so a recomputed value wins wherever it is non-null. The pass
therefore fills `night_hrv_baseline_ms` — which is the point — **and in the same statement
overwrites `resilience_level`, `resilience_granular` and the three daily indices on every day the
recompute publishes one.** TN-70's decisive question is *"do those 16 July days still come back as
5?"*, and running the pass answers it by deleting the before-value. You can only ask it once, and
only if the before-values were recorded first.

**The whole evidentiary base is 30 rows.** Of 132 rows in `oura_daily_derived` spanning
2026-05-07 → 2026-09-27, exactly **30 carry a `resilience_level`** — the 16 July/August days and
the 14 September days TN-70 tabulates. Everything below is those 30 rows, so the pass is now safe
to run in the sense that the comparison survives it.

Only the resilience columns and the date are recorded. No raw HRV intervals, heart rates or sleep
timings are copied here.

## Two corrections to TN-70, from this capture

**1. `confidence` does not merely fail to separate the regimes — it spans the IDENTICAL four
values in both.** The entry reports means of 0.464 (July) against 0.434 (September) and concludes
"the model was not less sure while emitting a constant". True, and weaker than the data supports:
both regimes draw from exactly `{0.357, 0.429, 0.500, 0.571}` = `{5/14, 6/14, 7/14, 8/14}`. It is
`validCount / 14` taking one of four values in both, so it carries **no** information that
distinguishes them. Do not re-derive a difference from the means.

**2. The "switch is carried by `resilience_daily_sleep_recovery`" finding rests on 5 days against
6, not 16 against 14.** The three daily indices are populated on only **5 of the 16** July rows and
**6 of the 14** September rows; the other 19 are NULL. The entry's ranges (~10–56 July against
0–17.6 September) are real, and the sample behind them is a third of what the entry's framing
implies. That does not overturn the mechanism — it is still the only stored column that moves
across the boundary — but it is thin enough that the recompute, not further reading of these rows,
is what would settle it.

A third asymmetry, already explained in the entry and confirmed here: `daytime_stress_coverage_min`
is present on **0 of 16** July rows and **14 of 14** September ones. That is the column's age
(added 2026-09-02, #817), not a missing measurement.

## The rows

| day | level | granular | confidence | coverage min | sleep_rec | stress | restorative |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-07-24 | 5 | 5.990 | 0.357 | — | 55.57 | 72.22 | 25.56 |
| 2026-07-25 | 5 | 5.990 | 0.357 | — | 13.52 | 76.60 | 14.89 |
| 2026-07-26 | 5 | 5.990 | 0.429 | — | 9.87 | 71.11 | 23.33 |
| 2026-07-27 | 5 | 5.990 | 0.500 | — | 51.45 | 82.28 | 16.46 |
| 2026-07-28 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-07-29 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-07-30 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-07-31 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-08-01 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-08-02 | 5 | 5.990 | 0.571 | — | — | — | — |
| 2026-08-03 | 5 | 5.990 | 0.500 | — | — | — | — |
| 2026-08-04 | 5 | 5.990 | 0.429 | — | — | — | — |
| 2026-08-05 | 5 | 5.990 | 0.357 | — | — | — | — |
| 2026-08-27 | 5 | 5.530 | 0.357 | — | 0.00 | 47.95 | 50.68 |
| 2026-08-28 | 5 | 5.790 | 0.357 | — | — | — | — |
| 2026-08-29 | 5 | 5.790 | 0.357 | — | — | — | — |
| 2026-09-07 | 4 | 4.030 | 0.357 | 280 | 17.56 | 44.05 | 55.95 |
| 2026-09-08 | 4 | 4.220 | 0.357 | 230 | — | — | — |
| 2026-09-09 | 3 | 3.990 | 0.357 | 260 | 0.00 | 37.04 | 55.56 |
| 2026-09-12 | 4 | 4.410 | 0.357 | 210 | 2.86 | 50.00 | 39.39 |
| 2026-09-13 | 4 | 4.620 | 0.357 | 210 | 0.00 | 38.89 | 42.59 |
| 2026-09-14 | 3 | 3.780 | 0.429 | 190 | — | — | — |
| 2026-09-15 | 3 | 3.010 | 0.500 | 290 | 0.00 | 31.58 | 47.37 |
| 2026-09-16 | 2 | 2.620 | 0.571 | 290 | 0.00 | 41.67 | 48.33 |
| 2026-09-17 | 2 | 2.770 | 0.571 | 170 | — | — | — |
| 2026-09-18 | 2 | 2.770 | 0.571 | 170 | — | — | — |
| 2026-09-19 | 2 | 2.530 | 0.500 | 120 | — | — | — |
| 2026-09-20 | 2 | 2.310 | 0.429 | 50 | — | — | — |
| 2026-09-21 | 1 | 1.010 | 0.357 | 150 | — | — | — |
| 2026-09-22 | 1 | 1.010 | 0.357 | 60 | — | — | — |
## How to re-capture

```
curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT day, resilience_level, resilience_granular, resilience_confidence, daytime_stress_coverage_min, resilience_daily_sleep_recovery, resilience_daily_stress, resilience_daily_restorative_time FROM claude_ro.oura_daily_derived WHERE resilience_level IS NOT NULL ORDER BY day"}'
```

`claude_ro` is row-scoped to the owner, so this is the owner's rows — which for this metric is the
whole table, since no other user has a ring on our key.

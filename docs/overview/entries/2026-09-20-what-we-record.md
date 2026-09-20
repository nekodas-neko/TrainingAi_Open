# What we record, and what it can actually say

**Tuning agent · 2026-09-20 · branch `tuning/tn53-metric-inventory-and-hrr-gate` · docs-only**

Owner: *"Have a look at all metrics we record or what can be calculated/correlated. We need a very
strong system here."* 99 tables inventoried. One defect, one better instrument nobody is using, and a
tiering of what can carry an analysis at all.

## The richest table in the app is also the least exploited

`set_hr_stats` — 33 columns, 918 rows — computes per-set heart-rate recovery: `drop_30s/60s/90s/120s`,
`trough_bpm`, `sec_to_hrr50`, `pct_hrr_at_rest_end`. HRR is among the best-validated autonomic markers,
and unlike resting HR it is measured against a **controlled stimulus**, which is what makes it
comparable day to day.

Its quality is entirely a function of which device was worn:

| source | rows | `coverage_ok` | readings/set |
|---|---:|---:|---:|
| **chest_strap** | 220 | **91%** | **111.8** |
| `ble` (ring) | 79 | 54% | **7.1** |
| *NULL* | **615** | **23%** | 17.0 |

Sixteen-fold density difference, exactly as the Polar knowledge base predicts. Only 24% of the table
comes from the source dense enough to measure a 60-second recovery, and that source has been dark
since 2026-09-15.

## TN-53 — one HRR path is gated and the other is not

`exercise-hr-trend.ts` filters every mean on `coverageOk`. **`/api/health/trends` does not** — it
ignores `set_hr_stats` and recomputes live, where `hrr1 = bpmAtLog − bpm60` and both terms come from
`nearestBpm(…, windowMs = 90_000)`: nearest reading within 90 s, no density floor, no check the two
readings bracket 60 s. At 1 reading/sec that is harmless; at 7 readings per set the two values can be
the same reading or 150 s apart.

**So the HR-Recovery sparkline moves partly with sensor availability.** The fix is a density gate
returning `null` — a gap is honest where a computed value is not.

## The better instrument exists and was left half-used

`fitness_tests` has a `resting_hrr` test type **and** an `hrr1_bpm` column. One test was run
(2026-07-19) and **`hrr1_bpm` is null on it.** A repeated HRR test controls the stimulus in a way
neither resting HR nor ring HRV can — it is the durable answer to the medication question, and it
needs no new code.

**And a negative result stated so it is not quoted later:** HRR-60 reads 5.8 → 4.0 bpm pre-dose vs on
Retatrutide, but n = 229 against 23 with sd 12.9. That is 0.15 sd. It means nothing.

## Tiering, so the next correlation is built on solid ground

**Dense enough to trend:** `oura_heartrate`, raw samples, `rr_intervals`, `daily_zone_minutes`,
`colmi_readings` (3,830 — and **zero scoring modules touch it**).
**Dense enough to correlate:** `set_hr_stats`, `body_metrics`, `sleep_sessions`, `day_checkins`,
`mood_logs`, `personal_records`.
**Too sparse for anything:** `dexa_scans` (**1**), `measured_rmr` (**1**), `fitness_tests` (3).
**Empty:** `blood_panels`, `blood_analytes`, `dexa_scan_regions`.

That last tier matters for TN-48: its fat/water/lean decomposition rests on scale estimates with one
DEXA and one RMR to anchor them, so its numbers should read as scale-relative until there is a second.

## What was not exercised

Stored production reads plus source reads, in the sandbox. No code changed, no scoring touched, no
device, no UI. Row-scoped to the owner.

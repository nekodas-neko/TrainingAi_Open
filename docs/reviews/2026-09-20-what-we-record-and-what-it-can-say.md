# What we record, and what it can actually say

**Tuning agent · 2026-09-20 · owner's rows only (`claude_ro` is row-scoped)**

The owner asked for a look across every metric the app records and what could be calculated or
correlated from it — *"we need a very strong system here."* This is the inventory, what each tier can
support, and the one defect the sweep turned up.

---

## 1. What is actually populated

99 tables are exposed. Grouped by whether they can carry an analysis today:

**Dense enough to trend (thousands of rows):** `oura_heartrate`, `oura_raw_samples`/`_packed`,
`rr_intervals`, `daily_zone_minutes`, `colmi_readings` (3,830).

**Dense enough to correlate (dozens to hundreds):** `set_hr_stats` (918), `body_metrics` (90-day
window ~100% for steps/SpO₂, 54% for the bioimpedance suite), `sleep_sessions` (119), `oura_daily_derived`
(65 with contributors), `day_checkins` (94), `workout_hr_stats` (99), `mood_logs` (103),
`personal_records` (40), `activity_logs` (59), `prescribed_runs` (23).

**Too sparse to support anything yet:** `dexa_scans` (**1**), `measured_rmr` (**1**),
`fitness_tests` (**3**), `exercise_estimates` (3), `injuries` (1), `oura_accel_chunks` (41),
`step_live_windows` (8).

**Empty:** `blood_panels`, `blood_analytes`, `dexa_scan_regions`, `oura_tags`.

---

## 2. The richest unused structure — and why it only half works

**`set_hr_stats` is the best-designed table in the app and the least exploited.** 33 columns, 918
rows, computing per-set heart-rate recovery: `drop_30s/60s/90s/120s`, `trough_bpm`, `sec_to_hrr50`,
`pct_hrr_at_rest_end`, `sec_to_preset`, `rest_adequate`. Heart-rate recovery is among the
best-validated autonomic markers there is, and unlike resting HR it is measured against a *controlled
stimulus*, which is exactly what makes it comparable across days.

**But its quality is entirely a function of which device was worn:**

| source | rows | `coverage_ok` | readings/set | span |
|---|---:|---:|---:|---|
| **chest_strap** | 220 | **91%** | **111.8** | 2026-08-05 → 09-15 |
| `ble` (ring) | 79 | 54% | **7.1** | 2026-08-06 → 09-19 |
| *NULL* (unlabelled) | **615** | **23%** | 17.0 | 2026-05-27 → 09-19 |
| mixed | 4 | — | 9.8 | — |

**A sixteen-fold difference in sampling density between the two sensors**, exactly as the Polar
knowledge base predicts (ring PPG is motion-noisy and power-gates under load). Only **24%** of the
table comes from the source dense enough to measure a 60-second recovery at all — and that source has
been dark since **2026-09-15**.

**⚠ The stimulus is also weaker than HRR wants.** Mean peak on a working set is **98 bpm** — about
56% of his 175 max — on strap data as much as ring data, so that is real rather than a sensor
artefact. HRR is validated after maximal and submaximal *aerobic* efforts; a drop measured from 98 bpm
carries far less signal. Measured pre-dose vs on Retatrutide: HRR-60 **5.8 → 4.0 bpm**, n = 229 vs 23,
sd 12.9 — **0.15 sd, which is nothing.** Do not read a drug effect into that.

---

## 3. The defect: two HRR paths, one gated and one not

`exercise-hr-trend.ts` filters every metric mean on `coverageOk` — *"a censored/sparse set
contributes to the breakdown"* but not to the numbers. Correct.

**`/api/health/trends` does not.** It ignores `set_hr_stats` entirely and recomputes HRR live:
`analyseHrRecovery(readings, sets)` over a raw `getHrForWindow`. In `hr-analysis.ts`,
`hrr1 = bpmAtLog − bpm60`, where both terms come from `nearestBpm(readings, target, windowMs = 90_000)`
— **the nearest reading within 90 seconds, with no minimum density and no check that the two readings
actually bracket 60 seconds.** On strap data (~1 reading/sec) that is fine. On ring data (7 readings
per set) the two "readings 60 s apart" can be the same reading, or 150 s apart.

**So the HR-Recovery sparkline on the heart-rate page is partly a record of which device was worn.**
Filed as **TN-53**.

---

## 4. What could be correlated, ranked by whether the data supports it

1. **A periodic HRR test — already built, used once, and its column left NULL.** `fitness_tests`
   carries a `resting_hrr` test type *and* an `hrr1_bpm` column. One test exists (2026-07-19: avg 120,
   max 152, resting 94) and **`hrr1_bpm` is null on it.** This is the right instrument for the
   question the owner keeps asking — is the medication moving my autonomic function — because it
   controls the stimulus in a way resting HR and ring HRV cannot. It needs no new code, only a
   repeated test and a populated column.
2. **Bioimpedance against a real reference.** TN-48's fat/water/lean decomposition rests on scale
   estimates with **one** DEXA scan and **one** measured RMR to anchor them. A second DEXA would
   convert TN-48 from *"the scale says"* into a calibrated measurement, and would also validate
   `bmr_kcal` against `measured_rmr`. **Until then TN-48 should state its numbers as scale-relative.**
3. **`colmi_readings` — 3,830 rows, 18 files reference it, zero in any scoring or domain module.** A
   second wrist device with more raw readings than `set_hr_stats` has rows. Worth one session
   establishing what it measures and whether it agrees with the Oura ring, because a second
   independent sensor is precisely what PS-44 wants and it is already streaming.
4. **Blood panels — the table exists and is empty.** The highest-value correlate for a GLP-1 user
   (lipids, HbA1c, kidney markers) has schema and no data. Worth knowing it is there before the next
   blood draw rather than after.

**⚠ Do NOT build correlations onto the sparse tier.** One DEXA, one RMR and three fitness tests cannot
support a trend, and presenting them as one would repeat the class of error this review exists to
catch.

---

## What was not exercised

Reads of stored production rows plus source reads, in the sandbox. No code changed, no scoring
touched, no device, no UI. Row-scoped to the owner throughout. The HRR comparison in §2 is a
descriptive split, not a controlled test.

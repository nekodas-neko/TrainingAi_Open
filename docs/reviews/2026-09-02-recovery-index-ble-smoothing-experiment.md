# Q-509's smoothing experiment: the input needed conditioning, and that is about half the answer

**2026-09-02 · Lane A · measurement only, no scoring constant moved.**

Q-509 pre-registered a pass test and asked for one experiment:

> **Concrete experiment:** smooth the BLE series to Cloud-like noise *before* the argmin and
> re-measure the ratio — if it goes to ~1.0 the estimator is fine and the input needed conditioning.

**It goes to 0.875, not ~1.0. The hypothesis is half right and fails its own test**, so a smoothing
change is not the fix and must not be shipped as one.

## What was re-confirmed first

| claim | Q-509 (2026-08-18) | this run (2026-09-02) |
|---|---|---|
| BLE-era `recovery_index_hours`, n | 42 | **57** |
| mean h | 2.657 | **2.653** |
| median h | 2.377 | **2.374** |
| median sample-to-sample \|Δbpm\| | 2.0 | **2.00** |

Fifteen more nights moved the mean by **0.004 h**. The level shift is not a small-sample artefact,
and the noise figure the whole mechanism rests on reproduces exactly.

## The experiment

`computeRecoveryIndex` (`packages/shared/src/health/recovery-index.ts`) rolling-medians the 5-minute
binned overnight series at `MEDIAN_WINDOW = 3`, takes the **first strict global argmin**, and reports
`wake − settledAt`. The proposed mechanism is that at 2× the sample-to-sample noise a spurious late
dip beats the true early minimum, moving `settledAt` later and `hoursToSettle` down.

Re-ran that exact procedure over 58 BLE-era nights of real overnight ring HR at widths 3 → 41.

**Reported as the absolute shift in settle time, not as a ratio of hours.** The reconstruction's
night window does not match the rollup's own (see the caveat below), so absolute hours are not
trustworthy — but a constant wake-time offset cancels out of `settledAt(w=3) − settledAt(w=N)`, so
the shift survives it.

| median window | mean shift earlier (h) | median | nights moved |
|---|---|---|---|
| 5 | 0.007 | 0.000 | 36/58 |
| 7 | 0.075 | 0.000 | 49/58 |
| 9 | 0.397 | 0.042 | 50/58 |
| 11 | 0.237 | 0.000 | 47/58 |
| 15 | 0.352 | 0.083 | 55/58 |
| **21** | **0.487** | 0.167 | 56/58 |
| 31 | 0.458 | 0.458 | 58/58 |
| 41 | 0.389 | — | 58/58 |

- **Gap to explain:** Cloud mean 3.59 h − BLE mean 2.657 h = **0.933 h**.
- **Best recovery from smoothing:** **0.487 h at window 21 — 52% of the gap.** It plateaus and then
  reverses; there is no width that closes it.
- **Pass test:** (2.653 + 0.487) / 3.59 = **0.875**. Not ~1.0.

**The mean is four times the median at the best width (0.487 vs 0.167).** The correction is not a
uniform bias being removed — it is a minority of nights moving a long way, which is exactly the
signature of "a spurious late dip beat the true early minimum" occurring *sometimes*. That supports
the mechanism Q-509 proposed while showing it cannot account for the whole level shift.

## What this means for the work item

1. **Do not ship a wider `MEDIAN_WINDOW` as the fix for Q-509.** It fails the entry's own
   pre-registered test, and a window of 21 over 5-minute bins is a 105-minute median — it would
   flatten real overnight structure to buy back half a defect.
2. **`RECOVERY_INDEX_OPTIMAL_HOURS` still must not move.** Nothing here argues against Q-500's
   6 → 5; the anchor-tracks-input result stands and remains the reason not to chase it with a
   second anchor change.
3. **Roughly half the level shift is still unexplained.** Candidates this run did not separate:
   the rollup's night-window detection differing between eras; bin occupancy (a bin with one beat
   in it is averaged the same as a bin with forty); and a genuine behavioural change across the
   six weeks between the two fits, which Q-509's own caveat already refuses to exclude.

## Caveat, stated because it bounds every absolute number above

**This reconstruction does not reproduce the shipped estimator's absolute level.** Mean hours here
is **4.27 h** against the stored **2.653 h**. The shipped path bins decoded `hr_bpm` from raw BLE
rows inside the rollup's own detected night window (`nightlyHeartRate`, `lib/oura-ble/rollup/run.ts`);
this reconstruction bins `oura_heartrate` inside `sleep_sessions.sleep_start … sleep_end`. Those
windows differ, and the ~1.6 h offset is not otherwise diagnosed here.

**One reconstruction error was found and fixed mid-run, and it is worth recording**: `oura_heartrate`
holds **66,189 `chest_strap` rows against 16,640 `ble` rows** in the BLE era, and the first pass
pulled both — mixing Polar H10 workout HR into overnight series. Filtering to `source = 'ble'` moved
the mean only 4.36 → 4.27 h, so it was not the cause of the offset, but an unfiltered read of that
table is a trap for the next person. **Checked: no production code has it.** The comparison harness
filters by source explicitly, `hr-day` returns `source` per row, and the unfiltered
`getOuraHeartrate` local read has no caller outside its own test.

## Reproducing

Production read-only via `/api/admin/db-query`, `claude_ro` (row-scoped to the owner). 58 nights,
5,806 five-minute bins, 2026-07-07 → 2026-09-02. The procedure is a direct transcription of
`computeRecoveryIndex`; re-run it after any HR-conditioning change, and the pass test is the ratio
reaching ~1.0.

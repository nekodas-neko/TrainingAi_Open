# Recovery Index, BLE era: bin occupancy is not the missing half (Q-509)

**Date:** 2026-09-02 · **Agent:** Implementation Lane A · **Entry:** Q-509

[`2026-09-02-recovery-index-ble-smoothing-experiment.md`](2026-09-02-recovery-index-ble-smoothing-experiment.md)
ran Q-509's pre-registered smoothing experiment, recovered **0.487 h of the 0.933 h gap (52%)** and
stopped there, naming three candidates it could not separate:

1. the rollup's night-window detection differing between eras,
2. **bin occupancy** — "a bin with one beat in it is averaged the same as a bin with forty",
3. a genuine behavioural change across the six weeks between the two fits.

This run closes **candidate 2 outright** and bounds the mechanical part of candidate 1. It also
retires that review's standing caveat: the shipped estimator's **absolute** level is reproducible
after all, and the method is written down below so the next run starts from a validated instrument.

## The premise, checked in the code first

Both halves of the candidate are real as stated:

- `nightlyHeartRate` (`packages/shared/src/health/night-vitals.ts`) disqualifies a bin from
  **resting HR** at `b.n < MIN_BEATS_PER_BIN` (3), but the `bins` array it returns is filtered on
  `b.n > 0` only — deliberately, per its own comment, because "the recovery curve wants the shape of
  the whole night".
- `lib/oura-ble/rollup/run.ts` then maps that array to `{ timestamp, bpm }` and **drops
  `beatCount`**, so `computeRecoveryIndex` could not apply an occupancy rule even if it wanted one.
  Its statistic is the first strict global argmin of a rolling median at width 3 — the statistic
  most exposed to a single unreliable point.

So the mechanism is available. The question is only whether it fires.

## Method — a reconstruction that reproduces the shipped number

The earlier review binned `oura_heartrate` inside `sleep_sessions` and landed at **4.27 h** against
a stored mean of **2.653 h**, so it could report shifts but not levels. Three changes fix that:

1. **Decode the raw frames**, not `oura_heartrate`: tags `0x80` and `0x60` from
   `claude_ro.oura_raw_samples`, through `decodeEventBody`, taking `hr_bpm` and the same
   `[35, 150]` plausibility band the rollup uses. This is the rollup's actual input.
2. **Bin and space in `ds`, never in wall clock.** `measured_at` is an ingest stamp and drifts
   against `ring_timestamp_ds` — using it to place bins put **98 bins inside a 7.58 h window**,
   which holds 91. Bins are `floor(ds / HR_BIN_DS)` and their times are `refMs + (ds − refDs)·100`.
   Only the window **endpoints** are located by `measured_at`, via the nearest row.
3. **Take the window from `sleep_sessions`, which is the clamped window.** `run.ts` mutates `w` in
   place through `clampToDenseSensing` *before* writing `sleepStart`/`sleepEnd`, so the stored row
   is the same span the HR bins are filtered to — not, as assumed, a looser one.

Validation, against `oura_daily_summary.recovery_index_hours` on the nights whose window is
unambiguous:

| night (wake date) | reconstructed | stored | Δ |
|---|---|---|---|
| 2026-08-28 | 2.65 | 2.68 | 0.03 |
| 2026-08-31 | 5.73 | 5.52 | 0.21 |
| 2026-09-01 | 2.10 | 2.17 | 0.07 |

**2026-08-27 is the fourth night and it disagrees for a known reason**: the real night reconstructs
at 0.54 h and the stored value is 4.40 h, which matches the **phantom** 4.3 h daytime window
(3.85 h) that PS-17 documents winning that date under the old last-wins rule. The row predates
today's fix. That is the harness agreeing with the defect, not with the night.

Sample: **59,143 raw IBI rows, 1,814 five-minute bins, 8 sleep windows, 2026-08-26 → 2026-09-02.**
`oura_raw_samples` retains about seven days — older frames are packed into `oura_raw_packed` — so
this is the whole raw archive that is still directly readable, not a subsample of it.

## Result — occupancy does nothing

| night (sleep start) | night bins | bins below `MIN_BEATS_PER_BIN` | settle h (shipped) | beats in the argmin bin | settle h (sparse bins excluded) | shift |
|---|---|---|---|---|---|---|
| 2026-08-26 | 89 | 0 | 0.54 | 254 | 0.54 | 0.00 |
| 2026-08-27 (phantom) | 50 | 0 | 3.85 | 81 | 3.85 | 0.00 |
| 2026-08-27 | 97 | 0 | 2.65 | 258 | 2.65 | 0.00 |
| 2026-08-29 | 21 | 0 | 0.29 | 105 | 0.29 | 0.00 |
| 2026-08-30 | 12 | 0 | 0.46 | 81 | 0.46 | 0.00 |
| 2026-08-30 | 104 | 0 | 5.73 | 282 | 5.73 | 0.00 |
| 2026-08-31 | 99 | 0 | 2.10 | 237 | 2.10 | 0.00 |
| 2026-09-01 | 103 | 0 | 1.46 | 249 | 1.46 | 0.00 |

- **Mean shift 0.000 h. Nights moved: 0 of 8.**
- **The argmin never landed on a sparse bin** — it carried **81 to 282 beats**, against a threshold
  of 3.
- Across **575 night bins not one** falls below the threshold.

The reason is visible in the numbers: overnight the ring streams **hundreds** of quality beats per
five-minute bin, which is what `clampToDenseSensing`'s comment already says ("only streams DENSE
continuous HR (hundreds/epoch) while asleep"). Sparse bins do exist in the archive — 86 of 1,827 bins in the same
span hold five raw rows or fewer — but they are a **daytime** phenomenon: none falls inside a sleep
window.
**Candidate 2 is closed: occupancy cannot account for any part of the residue.**

## What the same run says about candidate 1

Widening each window by **two hours at the start** — the shape of "the detector's onset truncates
the search before the night's true minimum" — moves **1 of 8 nights**, by 0.75 h, for a mean of
**0.094 h**. The night it moves is a **12-bin (1 h) window**, i.e. one the detector barely found.
Full-length windows (89–104 bins) do not move at all.

Stored data agrees and puts a number on it. Bucketing all 57 BLE-era nights by their longest
detected window:

| longest window | nights | mean `recovery_index_hours` |
|---|---|---|
| < 4 h | 2 | 1.648 |
| 4–6 h | 1 | 1.493 |
| ≥ 6 h | 54 | **2.712** |

Degenerate windows are real and they are cheap: 3 of 57 nights, worth **≈ 0.06 h** of the mean. The
same holds for fragmentation — nights whose date carries more than one window average **2.719 h**
against **2.639 h** for single-window nights, so `recoveryIndexHours: last.recoveryIndexHours`
(`run.ts`, which takes the value from the night's **final** segment and therefore searches only
that fragment for the minimum) is a code smell that is **not** costing anything measurable today.

**The 54 full-length nights still average 2.712 h against the Cloud era's 3.59.** The level shift
lives in ordinary, well-detected nights — not in the degenerate ones — which is the single most
useful thing this run establishes about where to look next.

## Where Q-509 now stands

Of the 0.933 h gap: smoothing accounts for **0.487 h**, occupancy for **0.000 h**, degenerate or
fragmented windows for **≈ 0.06 h**. Roughly **0.39 h remains, in nights with nothing visibly wrong
with them.**

Nothing here changes the entry's two standing prohibitions, and both now have one more reason:
**do not widen `MEDIAN_WINDOW`** and **do not move `RECOVERY_INDEX_OPTIMAL_HOURS`**. Two of three
mechanical explanations have now been measured and found not to be it, which raises rather than
lowers the chance that the remainder is candidate 3 — a real change across the six weeks — and a
constant moved to absorb a real change is the harder mistake to undo.

## One thing found on the way, filed on Q-510

**`oura_daily_derived.recovery_index_hours` is NULL on all 107 rows**, and no producer writes it —
the rollup sets `recoveryIndexHours` on the night input, which lands in `oura_daily_summary`, and
`readiness-payload.ts` reads it from there. The derived column nonetheless has a full local mirror:
a SQLite column, a `RECONCILE_COLUMNS` row, both upserts, the pull mapper and the sync mapper. It is
the same shape as `worn_hours_ble` (also 0 of 107) and the same decision — populate it or drop it,
and dropping is destructive — so it joins that item on Q-510's `Keep:` rather than opening an entry
of its own.

## Reproducing

Read-only production via `/api/admin/db-query` (`claude_ro`, row-scoped to the owner, capped at
**1000 rows per request** — page with `ring_timestamp_ds > <last>`, not `OFFSET`, and pace the
requests or the endpoint answers `Unauthorized`). Pull `ring_timestamp_ds`, `tag`, `body_hex`,
`measured_at` for `tag IN (128, 96)`, and `date, sleep_start, sleep_end` from
`claude_ro.sleep_sessions`. Then follow the three method rules above — decode the frames, bin in
`ds`, take the window from `sleep_sessions` — and check the reconstruction against
`oura_daily_summary.recovery_index_hours` before trusting any absolute number it produces.

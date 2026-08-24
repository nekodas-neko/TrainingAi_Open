# "The scores have been very varied lately" — measured — 2026-08-24

*Tuning · production data pulled 2026-08-24. Filed as [`TN-5`](../implementation-backlog.md).
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

## The report

Owner, 2026-08-24: *"the scores have been very varied lately"*.

## The observation is correct, and it is sleep

Day-to-day absolute change in the **stored** score, split at 2026-08-19 (when the sleep
recalibration began reaching stored rows):

| score | before | since | median before → since |
|---|---|---|---|
| **sleep** | **9.2** | **21.2** | 5 → 20 |
| readiness | 11.1 | 12.8 | 9.5 → 10 |
| activity | 7.2 | 12.2 | 4.5 → 7 |

Sleep more than doubled. Readiness barely moved. `n = 6` on every "since" figure, so the
mechanism below is the evidence, not this table.

## Your sleep did not become more erratic

Reconstructing the pre-calibration weighted blend for all 41 nights that store
`sleep_contributors` (weights from `SLEEP_WEIGHTS`, renormalised over present contributors):

| | before 2026-08-19 | since |
|---|---|---|
| blend, night-to-night mean \|Δ\| | **9.15** | **9.27** |
| blend sd | 11.58 | 12.27 |
| blend **mean** | **87.1** | **71.1** |

**The underlying signal moves by the same amount it always did.** What changed is where it lands.

Two things happened at once on 2026-08-19, and both push displayed volatility up:

1. **The calibration started applying.** For 2026-08-13 → 08-18 the stored score equals the *blend*
   (blend 72.4 → stored 72; blend 88.3 → stored 88), i.e. gain 1.0×. From 08-19 the stored score
   equals `interp(blend)` (blend 46.7 → stored 39; blend 75.9 → stored 64). A score that was passing
   the blend through began passing it through a curve.
2. **The blend fell into the steep part of that curve** — mean 87.1 → 71.1.

## The real defect: the curve's gain varies 8-fold

`SCORE_CALIBRATION` (`packages/shared/src/health/sleep-score.ts:155`), display points per blend point:

| blend segment | gain | nights |
|---|---|---|
| 50.0 – 65.4 | 0.45× | 0 |
| 65.4 – 74.0 | 1.16× | 2 |
| **74.0 – 78.0** | **3.00×** | 4 |
| **78.0 – 81.0** | **4.00×** | 3 |
| 81.0 – 85.6 | 1.96× | 3 |
| 85.6 – 88.7 | 1.94× | 6 |
| 88.7 – 91.0 | 0.87× | 8 |
| 91.0 – 93.0 | 0.50× | 4 |

**A one-point improvement in your actual sleep is worth 4 displayed points at blend 79 and 0.5 at
blend 92** — an 8-fold difference in what the same real change means, depending on where you happen
to be sitting. Six of the last twelve nights landed on the 3.0×/4.0× segments.

That non-monotonic gain is a defect independent of the volatility complaint, and it is the thing
worth fixing.

## ⚠️ Flattening the curve will NOT reduce the volatility — measured

The standing advice in the Tuning baton was *"if the new spread reads as jitter, flatten
`SCORE_CALIBRATION`'s 74–85 segment"*. **That was tested here and it does not work**, for a reason
that should have been obvious in advance: the curve has to climb from 0 to 100 across the blend's
range, so flattening one segment necessarily steepens another. Total movement is conserved.

Candidate curves over the same 41 nights:

| curve | displayed mean | sd | night-to-night mean \|Δ\| | gain min | gain max | gain spread |
|---|---|---|---|---|---|---|
| current | 87.0 | 18.36 | **13.53** | 0.50× | 4.00× | **8.0×** |
| uniform-gain | 85.5 | 17.01 | **13.75** | 1.87× | 1.90× | **1.0×** |
| mean-preserving | 82.4 | 18.23 | 15.43 | 1.16× | 3.04× | 2.6× |

Uniform gain **increases** night-to-night movement slightly (13.53 → 13.75). It fixes
interpretability, not jitter. Anything that genuinely reduces displayed volatility does so by
compressing the scale — which is the range the 2026-08-17 recalibration was asked to create, and
undoing it re-opens Q-511 (sleep and readiness agreeing is load-bearing for the Body Battery anchor).

**So the residual variance is real signal.** The blend moves ~9.9 points a night on its own; the
curve adds ~1.4×. Nothing here says the model is wrong about how variable the owner's sleep is.

## Recommended: uniform-gain, and say plainly that it is not a jitter fix

`[[0,0],[20,18],[34.6,33],[50,41],[65.4,48],[74,64.2],[78,71.7],[81,77.4],[85.6,86.0],[88.7,91.9],[91,96.2],[93,100]]`

- Gain spread **8.0× → 1.0×**.
- Displayed mean over 41 nights **87.0 → 85.5** — a small *drop*, so it does not violate
  "do not lift the sleep scale back toward its old mean" (Q-511). Recent-day mean rises 60.9 → 63.2.
- **`LOW_SLEEP_SCORE = 42` needs no re-anchoring** — firing rate is 2/41 (5%) on the current curve
  and 2/41 on all three candidates. Verify before shipping rather than assuming it stays.
- The `[93, 100]` ceiling anchor is preserved. Three tests assert the ceiling is reachable but not
  routine; do not move it.

## What this does not cover

Readiness (11.1 → 12.8) and activity (7.2 → 12.2) both moved too, on `n = 6`. Activity is the more
interesting of the two — the cross-pillar table has it as the most compressed score in the app
(sd 6.0), so 12 points a day would be a real change in character. **Not filed**: six deltas cannot
distinguish a change from a run of unusual days, and manufacturing a finding from it is exactly the
error this file's own `n = 6` caveat is about. Re-measure at `n ≥ 20`.

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. The blend reconstruction is a
re-implementation of `computeSleepScore`'s weighted mean in Python and is validated by matching the
stored score to ±1 on every night since 2026-08-19 (where the stored value is `interp(blend)`) and on
2026-08-13 → 08-18 (where it is the raw blend). Curve candidates were evaluated in Python, not
against the shipped TypeScript.

# 2026-09-24 — the prescription is followed; the field that proves it regressed

**Branch:** `tuning/planned-pct-coverage` · **Agent:** Tuning · **Docs-only.**

TN-64 established that readiness gates no prescription. The complement is whether the prescription itself
lands, and `set_logs` carries both planned and actual.

## It lands, and that is worth recording

Where both are present (432 sets): mean load deviation **−0.81 percentage points** (sd 3.45), **214 of
432 (50%) inside half a point of plan**, reps **exact on 228**, mean rep deviation **+0.45**, and only
**17 sets under** the prescribed reps.

So the owner follows the prescribed load closely and overshoots reps rather than falling short. **The
prescription path works** — what TN-64 found disconnected is the readiness *input*, not the mechanism.
Drawing "the app's advice is ignored" from TN-64 alone would have been wrong.

## The regression

| month | sets | with a plan | coverage |
|---|---:|---:|---:|
| 2026-05 | 332 | 0 | 0% |
| 2026-06 | 165 | 0 | 0% |
| 2026-07 | 372 | 147 | 40% |
| 2026-08 | 266 | 247 | **93%** |
| 2026-09 | 151 | 109 | **72%** |

The field arrives in July, peaks at 93%, then **loses 21 points in September**. Two shapes inside that:

- **A five-session hole, 09-07 → 09-12: 24 sets, zero plans.** Those sessions also ran **4–5 sets each
  against 10 either side**, with `intensity_mode` NULL where 09-02→09-06 carry `'deload'`.
- **A steady residue** from 09-14 on, sitting at 8 of 10. Against set position the loss is even — **7 of
  40 on set 1, 7 of 40 on set 2** — so it is whole exercises lacking a plan, not late sets losing one.

## The unification I nearly filed, and why it is false

`planned_pct` derives from a 1RM, so a log with `estimated_1rm = 0` (TN-74) should have no prescribable
percentage — one root cause for two entries. Measured since 2026-07-01: **16% of sets WITH a plan sit on
a zero-1RM log (81 of 503), against 4% of sets WITHOUT one (11 of 286).** The association runs the
opposite way to the prediction, and missing `style_id` does not explain it either (13 of 286). **Two
independent defects.**

## Why it costs the analysis, not just the record

`planned_pct` is the only column that makes adherence measurable. The figures above could be computed on
**39% of sets** (503 of 1,286), and on the five-session hole not at all. Every future claim about whether
the app's advice was taken is bounded by this coverage.

Filed **TN-75, `Lane: A`**.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**. **Not established:** why those
five sessions differ; which exercises carry the steady residue (the even split by set position says
per-exercise, but they were not named); and whether the −0.81-point deviation is plate rounding rather
than under-loading — that check would settle it and was not run. `pnpm check:rules` result below.

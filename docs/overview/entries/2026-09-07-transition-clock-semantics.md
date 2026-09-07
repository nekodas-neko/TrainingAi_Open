# 2026-09-07 — the transition contradiction was my own double-count (LA-65)

**Branch:** `fix/transition-constant-measurement` · **Lane A**

## What LA-65 was filed on, and why it was wrong

Filed this morning off the BF-128 pass, LA-65 recorded that `TRANSITION_SEC_BARBELL = 240` measured
"contradictorily" — 249 s counting unstamped rows as zero, 316 s where actually recorded, and an
implied **+20.8 min over-prediction** of the working window when the recorded value was fed into the
model. The entry concluded the field's meaning was unsettled and the constant could not be retuned
until it was.

**The contradiction was an error in my own measurement.** I had summed
`inter_exercise_rest_sec + prep_time_sec` as "the transition". They are not additive.

## The measurement, against an independent clock

`set_start_ms` / `set_end_ms` are stamped per set and are not derived from either field, so the gap
between one exercise's last set end and the next's first set start is an independent measure of the
transition. Across **171 transitions**:

| compared against the implied gap | median error |
|---|---|
| `inter_exercise_rest_sec` alone | **−0.05 s** |
| `inter + prep` | **+135.7 s** |

Split by whether prep was recorded at all, `inter` alone matches in both buckets (mean 229.8 vs
implied 229.8; mean 402.0 vs implied 402.0).

**And it holds by construction, not just by correlation.** `components/workout-screen.tsx` computes
`interExerciseRestSec` as `exerciseStartMs − lastExerciseEndMs`, and `exerciseStartMs` is stamped
inside `handleStart` — the same function that computes `prepSecRef` from the ready-screen baseline.
So prep is the *tail* of the same interval that `inter` measures end-to-end.

With the corrected definition the session reconciles:

| | before (inter + prep) | after (inter alone) |
|---|---|---|
| work + rest + transition | 58.1 min | **50.0 min** |
| measured working window | 47.9 min | 47.9 min |
| excess | **+10.2 min** | **+2.1 min** |

## The live defect this found

`/api/workout-sessions/[id]/timing` reported `setupActualSec` from **`prepTimeSec`** and compared it
against **`transitionSecForEquipment`**, which models the whole transition — a part against a whole.
Median prep on a non-first exercise is **2 s** against a 240 s expectation, so the screen reported
setup as four minutes *faster* than expected while the real transition ran ~300 s, i.e. **slower**.
Now reads `interExerciseRestSec ?? prepTimeSec` — the fallback covers the first exercise of a
session, which has no preceding gap and whose prep (mean 286 s, the ramp from the ready screen) is
the right actual there.

`time-audit.ts` was checked for the same defect and is correct: it uses `interExerciseRestSec` alone
at all three sites and never adds prep.

## The finding worth more than the fix

The real transition is **~300 s per gap** (mean 316, median 299) against a 240 s constant — but **the
constant is charged per exercise, and a session has one fewer gap than exercises.** At the owner's
five: 5 × 240 = 1200 s, and 4 gaps × 300 = 1200 s, against a measured 19.8 min (1188 s) of real
transition per session. **The two errors cancel exactly at N = 5, and only there.** At N = 3 the
model over-reserves ~120 s; at N = 8 it under-reserves ~180 s.

**Nothing was retuned, and that is a decision rather than an omission.** Raising the constant to the
measured 300 s takes the powerbuilding 60-min blend from 598 s to 634 s and `floor(3060 / 634)` back
to **4** — undoing the 4→5 that shipped this morning to fix the owner's own report. The
correct fix is to solve for N against `N × work + (N − 1) × transition ≤ budget` rather than dividing
by a per-exercise average, and that changes volume at every budget except the one he trains at.
LA-65 is rewritten with the arithmetic and gated on the owner, whose BF-128 Known-Issues row already
asks whether five exercises fits the hour in practice. If it does, this is a cleanup to schedule; if
it does not, both are one fix and should be made together.

## Verification

- Mutation-tested three ways: revert to `prep`; sum the two; prefer `prep` over `inter`. All three
  fail the suite. The test exercises the real `GET` handler rather than a copy of its logic.
- Full suite **6693 passed | 86 skipped**; `tsc` clean; test-typecheck at baseline; Custom Rules
  **68 of 68**.

**Not exercised:** the timing screen on the S25, and no `pnpm dev` call — the route needs a completed
session with stamped set timestamps, which the seeded dev user does not have. The change is one
expression on a read-only route, covered by handler-level tests against both the present and absent
cases.

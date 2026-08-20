# 2026-08-19 — the workout burn now responds to effort (Q-421, route a)

**Branch:** `feat/hr-based-workout-energy` · **Lane:** Implementation A

## What was wrong

The MET formula in use is **explicitly the fallback path** — `workout-energy.ts`'s own header says it
ports Oura's closed form for the branch where `has_enough_motion === false`. It is
`duration × (MET − 1.5) × bmrPerMinute`, so **load, volume and reps are not inputs**: a 49-minute
session moving 2,364 kg and one moving 800 kg produce the same number.

Meanwhile heart rate — the one stored signal that does respond to effort — was ignored by the
calorie estimator entirely, while already feeding Readiness and Activity.

## Route (a), chosen by the owner

Two routes were on the table. **(b)** is the vendored ONNX model, which is genuinely already
downloaded and tested with zero callers — but its 50-feature vector's order and units are not
documented in this repo, and the external-field-names rule says such a layout is read from the
pinned source, never guessed. **(a)** is a closed-form HR estimator: no model, no new dependency, and
immediately better than duration × MET.

Owner chose **(a)**.

`estWorkoutKcalFromHr` is the Keytel et al. (2005) regression, sex-specific, kJ/min → kcal.
`computeActiveEnergy` prefers it per session and falls back to the MET tier whenever it returns
`null`. `getAvgBpmBySession` batch-reads `avg_bpm` for a whole window — the existing
`getWorkoutHrStats` is per session, which would have been N queries on a route that already runs many.

## Blast radius, measured — not assumed

- **Coverage: 42 of 78** completed sessions carry an `avg_bpm`. The other 36 keep the MET estimate
  **permanently** — the strap is not always worn, so the fallback is the common case, not a migration
  state.
- Owner profile **33 y / 71.5 kg / male**, median session **58 min**, and the real avg-BPM range is
  **73–104, median 91** — resistance training, not steady-state cardio.

| avg bpm | Keytel kcal |
|---|---|
| 73 (min) | **164** |
| 91 (median) | **321** |
| 104 (max) | **435** |

The MET path's own test pins a 55-minute session to a **~200–400** band. So this **overlaps rather
than inflates**: low-HR sessions move down, high-HR sessions move up. That redistribution *is* the
feature.

## The number that would have been wrong to quote

A first local check injected **150 bpm** and got **823 kcal**. That is arithmetically correct and
completely misleading — **150 does not occur in this data** (max 104). Keytel is fitted on
steady-state aerobic subjects and is known to over-read for intermittent resistance work, where HR
stays elevated between sets without the matching oxygen cost. At the owner's observed HRs it behaves;
at cardio HRs it would over-read, and **that over-read is exactly what route (b) exists to fix**.

Recorded because quoting the 823 as a prediction would have been a plausible, checkable, wrong claim.

## Verified

End-to-end against `pnpm dev`, same session, HR row inserted then removed:

```
avg_bpm 150 present → workoutKcal 823   (HR path)
avg_bpm absent      → workoutKcal 0     (MET fallback; 0 under the scrubbed fixture MET)
```

16 unit cases on the estimator — including the published-regression reproduction, HR and duration
scaling, the zero floor, the plausible-range rejections and the incomplete-profile cases — plus 4 on
the precedence and fallback inside `computeActiveEnergy`, one of which covers **mixed** coverage and
asserts the addends still reconcile with the total. Full suite **509 files, 4,333 tests, 0 failed**;
`tsc` clean; `pnpm check:rules` **Ran 50 of 50**.

**A first-draft docstring claim was wrong and its own test caught it:** I wrote that the regression
goes negative "at 60 bpm", which is true for a light young profile (20 y / 50 kg male: −0.78 kcal/min)
and false for this one (33 y / 80 kg: **+1.27**). Both the comment and the test now say which, so the
floor reads as a real guard rather than dead code.

## Not exercised

Nothing on device; no production write. **Route (b) is untouched** and still blocked on the feature
spec. The entry's "store which basis was used and label it" note is also still open — the basis is
currently chosen silently per session, and surfacing it is a UI decision (Lane B).

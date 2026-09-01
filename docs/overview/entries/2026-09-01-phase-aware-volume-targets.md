# 2026-09-01 · Lane A — a peaking week stops reading as a deficit (BF-59, the screen's half)

Branch `lane-a/phase-aware-volume-targets`. **No migration, no schema change** — the fix is that a
number stops being stored and starts being derived. **Not device-verified.**

## The target was measuring the wrong thing, and the owner said so first

> *"i did the full sessions for the week; and i was nowhere near hitting the reccomended amount of
> muscle sets."* … *"oh yes cause its realization phase its been less sets."*

MAV is an **accumulation** target. Showing it during a peak tells an athlete that doing the right
thing is wrong — which is worse than a wrong number, because a wrong number is at least ignorable.
Their week was correct training and the screen painted it red.

## Both halves of the entry were verified against production before anything was built

| claim | measured |
|---|---|
| the stored targets are a flat binary | 15 rows, all 14 or 10 — **seven at 14, eight at 10** |
| they ignore the program's goal | `Shikai` is `powerbuilding` = **×0.8**, and no stored row reflects it |
| a week is not in one phase | 10 sessions: **6 accumulation, 3 realisation, 1 intensification** |

The third is what makes this unstorable: phase lives in `session_periodization` **per program
session**, so there is no "this week's phase" that a column could hold. There is only the mix of
what was trained.

## Derived, not corrected

The entry proposed a corrective migration. That would have needed the landmark table expressed in
SQL — a second copy of the formula, which is the class the entry is filed under. So the route
computes the target instead:

```
weeklyVolumeTarget(goal, muscle, weekPhases)
  = max(1, round(volumeLandmarks(goal, muscle).mav × phaseVolumeScale(weekPhases).scale))
```

`program_volume_targets` keeps supplying **which** muscles the program trains. Its number is no
longer read by anything the user sees. That is the honest state and it is written into the entry, so
nobody "fixes" the rows back.

**The phase mix weights by workout session, and takes what was TRAINED rather than what was
scheduled.** The bar compares this week's logged sets against the target, so the target has to
reflect the sessions those sets came from; training one session twice is two sessions' worth of that
phase. An empty week scales by 1 — the accumulation baseline, which is exactly what the card showed
before this existed.

## The multipliers are the owner's, and they are a calibration

Accumulation 1.0 · intensification 0.8 · realisation 0.6 · deload 0.5, chosen 2026-09-01 from a
proposal. `baseline` sits at 1.0 deliberately: it is a testing phase with no volume prescription of
its own, and scaling it would invent one. The ladder follows behaviour the engine already had —
`explain.ts` calls realisation *"peak strength — heaviest load, lowest reps"* and `autoregulation.ts`
already refuses rep pushes in it.

## The formula test could not have caught the bug

`weeklyVolumeTarget` being right is worth nothing while the route still reads the stored column, so
the route test stores a target of **999** and asserts the response never contains it. That is the
only assertion that can tell *derived* from *read*. Four mutations, four caught:

| mutation | caught by |
|---|---|
| read `targetSetsPerWeek` again | *never returns the stored number* (3 cases) |
| ignore the week's phases | *asks for less once the week is a peaking one* |
| drop the `deleted_at` guard | *ignores a deleted workout session* |
| `SELECT DISTINCT` the program session | *counts a session trained twice as two sessions* |

One assertion was wrong and the correction is the interesting part: triceps' goal-adjusted MAV is
12 × 0.8 = 9.6 → **10**, which is exactly what the binary stored. One muscle in fifteen where a
coarse binary lands on the right answer by arithmetic accident — and a standing reason why "the
numbers look about right" was never evidence those rows were derived from anything. It is now its
own named test.

## Exercised on a running server, not only in tests

`pnpm dev`, seeded with three roster rows holding **999**:

- nothing trained → `phase {scale: 1, dominant: null}`, chest **10** (strength ×0.65 of MAV 16)
- one realisation session → `scale 0.6, dominant realisation`, chest **6**
- plus one accumulation session → `scale 0.8`, chest **8**

No 999 ever appeared. Fixtures deleted afterwards.

## What is NOT done, and it is a live inconsistency

`signals.ts` still builds the AI's per-muscle volume budget from the stored number. **Before this
change the screen and the engine were wrong together; now only the prescription is.** It is left for
its own PR because it changes prescribed sets on the device — a behavioural change needing a device
pass, where this one is a display change readable from a screenshot. It is the first `Keep:` on the
entry.

And **the card does not print the phase yet**. The route returns it; rendering is Lane B. Until that
lands the target simply moved with no explanation on screen, which is the option the owner
explicitly did not pick.

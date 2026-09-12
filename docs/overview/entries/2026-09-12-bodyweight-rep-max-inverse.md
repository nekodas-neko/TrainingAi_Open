# 2026-09-12 — a bodyweight rep max inverted with the wrong formula (BF-149)

The owner finished his recalibrated Lower session and asked why the Hanging Leg Raise summary read
**Previous 8 RM → This session 8 RM, "Consistent — solid work"** when the set above it said
**11 reps**.

No entry stayed in the backlog for this: it shipped in the same PR with nothing owed, so the queue
would only have carried a finished item. This is the record.

## A lossy round trip through two different formulas

His stored numbers reproduce it exactly.

Forward, `estimateOneRm` routes every bodyweight set through `amrapAverage1Rm` → `calcAmrap1RM`,
which is `calc1RM` scaled by `amrapScaleFactor`. At 11 reps: `calc1RM(100, 11) = 137.5`, × `0.93` =
**128** — the value in `exercise_logs.estimated_1rm` for that set, confirmed in production.

Reverse, `repMaxFromOneRm` inverts **`calc1RM`**, unscaled. The largest `r` with
`calc1RM(100, r) ≤ 128.5` is **8**.

The AMRAP discount is applied on the way in and never taken off on the way out, so every bodyweight
rep max was under-reported by exactly that factor — three reps at his range, and more above it
(0.88 past 12 reps, 0.82 past 20).

`repMaxFromOneRm` is not wrong where it already was. Its other caller, the exercise stats sheet,
builds its comparison table with `calc1RM` too, so that pair is self-consistent and says so in its
own comment. The defect was feeding a stored estimate — always AMRAP-scaled for bodyweight — to the
inverse of the unscaled formula.

## The fix, and the two decisions inside it

`repMaxFromAmrapOneRm` is new in `1rm.ts` and used by `exercise-summary-screen.tsx` for the two
rep-max values, which render only under `isBodyweight` and so cannot reach a weighted display.
`repMaxFromOneRm` and the stats sheet are untouched. Each inverse now pairs with its own forward
function — the One-Formula-One-Place reading here is not one inverse, but one per forward.

It scans for the **nearest** match rather than the largest value that fits, and that is
load-bearing. `amrapScaleFactor` steps down at 5/8/12/20 reps, so `calcAmrap1RM` dips across each
boundary — 8 reps gives 121.75 and 9 gives 120.25. The forward map is not monotone, so the
largest-that-fits search which is safe against `calc1RM` overshoots badly here: **20 reps would read
back as 28**. Nearest-match round-trips 29 of the 30 rep counts exactly. Both decisions are
mutation-checked — swapping the formula fails four cases, swapping nearest for largest fails three.

## The collision that cannot be fixed by a better inverse

5 reps and 6 reps both store **114.5**: the rep-factor gain from the extra rep is exactly cancelled
by the 1.0 → 0.97 step. No inverse can separate them, and the function returns the lower of a tie,
which is the claim the stored number supports.

That is the argument for eventually not inverting at all. `exercise_logs.avg_reps` already holds the
real figure — 11 for the set in question. For a bodyweight exercise the rep max *is* the reps, so
the card reconstructs, lossily, a number the database already stores exactly. The inverse is only
needed where a historical series has no per-set reps to hand. Worth doing when someone next touches
this card.

## Not exercised

The card was not rendered in a browser — the fix is pure display math, covered by unit tests against
the owner's own stored value (128 → 11). His next bodyweight set is its first real render.

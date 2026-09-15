# 2026-09-15 — four owner decisions, and a measurement that reversed my own fix order

**Tuning.** Docs-only. The owner asked to be asked every question blocking Tuning's queue; four came
back answered, and checking one of them against real days overturned the recommendation I had made.

## TN-36 — the fix order was backwards

I filed the deload finding with *"give readiness a way to clear a day"* as step 1 and called it the
cause. Simulating each fix against the owner's last 22 days says otherwise:

| | Sept days recommending a deload |
|---|---|
| today | **11 of 15** |
| stress override unwired | **1 of 15** |
| plus the readiness-clears rule | **1 of 15** |

The owner's streak reaches three exactly once in 22 days, so `consecutiveTrainingDays < 3` was
already clearing nearly every day and the stress override was doing essentially all of the
over-recommending. The structural defect is real — readiness 100 still returns `recommended: true` —
but it is not what the owner is feeling and it moves nothing on current data.

**Order reversed, gate lifted, and both halves stay separate** so the re-measure has one variable.
The remaining recommendation on 09-15 is the engine working: three training days behind it and
readiness 40.

**What produced the correction was simulating rather than reasoning.** The original ordering came
from reading the code, where the readiness ladder is plainly the structural defect. It is, and it is
also inert here. A code read cannot tell you which defect a user is feeling.

## TN-38 task C — the inventory the decision needed

The owner declined the proposed core/adjustment line and asked to see every metric first, which was
the right call: the line reads as one decision and is really three, with very different stakes.

| | sleep | readiness | activity |
|---|---:|---:|---:|
| phone only | 35% | 35% | 63% |
| phone + basic wearable | 55% | 66% | 100% |
| plus sleep stages | 87% | 66% | 100% |

Activity reaches full core on any wearable because its heaviest terms are logged workouts and steps.
Sleep is the whole question — 48 of its 110 points sit in HRV, stages and restfulness. Written up
with the tiered metric inventory and the argument against putting stages in the core (stage
estimates differ wildly between devices, which reintroduces exactly the incomparability the core
exists to remove) in
[`docs/reviews/2026-09-15-every-metric-and-the-core-line.md`](../../reviews/2026-09-15-every-metric-and-the-core-line.md).

## Decided outright

- **TN-31** — the 3-on/3-off interval walk maps to `tempo`; a sixth run type waits until the
  protocol is run often enough to tune its band.
- **TN-38 task B** — build PS-41 now and validate when a friend onboards. There is no
  Health-Connect-only account and there will not be one.

## Not exercised

Docs-only; no code changed and nothing was run on the device. The 22-day simulation reconstructs
`computeDeloadStrength`'s branches from stored readiness, `stress_high_minutes` and completed
sessions — it is not the engine executing, and `energyLevel`/`selfReportedSick` were not
reconstructed, so both can only escalate. Every figure is the owner's own account via `claude_ro`,
which is row-scoped to one user.

# The Body Battery is useless, was already known to be, and got worse

**Tuning agent · 2026-09-20 · branch `tuning/tn2-remeasure-and-fitting-hazard` · docs-only**

The owner: *"can we look at the body battery too. Its pretty much useless at this point."* He is
right. The useful output of the review was an amendment to **TN-2**, not a new entry — TN-2 filed
this on 2026-08-24 with a better measurement than the one this session first reached for.

## What TN-2 already had, and did better

Body Battery charges only while HR ≤ `restingHr + 0.05 × (hrMax − restingHr)`. TN-2 measured that
ceiling **time-weighted** over 56 days — 0.5% of waking time able to charge — and explicitly warns
that a **per-sample** percentile is "wrong by an order of magnitude" for this, because the ring
power-gates its PPG. This session's first pass computed exactly the per-sample version it warns
about (0.99%). Same conclusion, flagged method.

TN-2 also already names the perverse part: resting HR fell 67 → 52, a real fitness gain, and the
ceiling is anchored to resting HR — so **the boundary becomes less reachable as fitness improves.**

## What is actually new

**It has got materially worse**, and the collapse is datable:

| period | charge ceiling | 5th-pct waking HR | gap | charged/day |
|---|---:|---:|---:|---:|
| 2026-06-30 → 08-19 | 65.8 bpm | 64.0 bpm | **−1.8** | **23.1** |
| 2026-08-20 → 09-06 | 57.9 bpm | 64.0 bpm | **+6.1** | **2.2** |
| 2026-09-07 → 09-19 | 58.7 bpm | 68.0 bpm | **+9.3** | **1.0** |

Charging fell **23×** the week the ceiling crossed below his quietest waking hour. Days ending at
zero went from 5 of the last 8 to **9 of the last 13**; the mean day now runs anchor 43.4 → end 6.2.

**And a new hazard for the fix.** TN-2's accepted direction is to anchor the rest boundary to
*waking rest*. Retatrutide started 2026-09-07 and his 5th-percentile waking HR has moved 64.0 → 68.0
in two weeks. **Waking rest is currently a medicated, moving target**, so an offset fitted to it now
would bake a pharmacological transient into a constant that re-scores every stored Body Battery day.
Fit against 2026-06-30 → 09-06 and validate forward. Not knowable when TN-2 was written.

## Why it is still not fixed

TN-2 is fully diagnosed and has owner sign-off. It is blocked on something real: the fit must include
the daytime-stress term, whose `.constants.json` files Q-49 removed from the repo and which do not
exist in a session container — plus `oura_raw_samples` retains only ~7 days of the 56 the pass test
needs, with `decoded` NULL on all of them. It needs a context with the constants present.

## Two column misreads, caught before they became findings

`hr_max_observed` is that day's own peak, not the reserve input — `hr_max` is, and it correctly holds
175. Reading the first produced a false "the reserve has collapsed to 105" theory that was abandoned
when the stored value sat below a floor the code enforces. The same class as the session's earlier
traps; the tell was an internal contradiction, not an external correction.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no
UI. Row-scoped to the owner.

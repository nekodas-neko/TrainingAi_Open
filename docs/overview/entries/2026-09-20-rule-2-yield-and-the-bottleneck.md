# Two negative results, and the one piece of infrastructure that matters

**Tuning agent · 2026-09-20 · branch `tuning/tn52-rule2-yield-and-the-real-bottleneck` · docs-only**

Owner: *"what else can be done on the tuning front?"* The honest answer is less than it looks, and the
useful part is naming why.

## Rule 2 re-screened the known thresholds and found nothing new

TN-52's rule 2 — refuse a window narrower than ~2× the signal's own sd — looked like it should find
more, because the 2026-08-25 threshold sweep names this exact blind spot: it is *"blind to a score
that moves normally and is compared against the wrong number."* Re-screening its 27 decision
thresholds by width-vs-noise instead of coverage:

| threshold | window | input sd | width | verdict |
|---|---|---:|---:|---|
| `HR_REST_THRESHOLD` | ~6 bpm | 3.15 bpm | **1.9 sd** | too narrow — TN-2 |
| `ILLNESS_WATCH → ELEVATED` | 25 pts | 9.96 | **2.5 sd** | clean |
| `FEVER_TEMP_Z` | unreachable | — | — | broken input, not width — Q-506 |
| `ACWR_TAPER_START` | never reached | — | — | already filed inert |
| `chronic_stress_score` | — | NULL 75/75 | — | already filed, Q-525 |

One confirmation, no new finding. **That it discriminates is the point** — the illness bands pass at
2.5 sd while the charge window fails at 1.9 — so rule 2 earns its place as a guard on *new*
thresholds and not as a sweep. The entry says so, to stop the next session repeating it.

## The bottleneck is one endpoint, not more measurement

The August sweep listed **25 thresholds it could not measure at all**: 19 sleep-staging constants in
one file, plus `APNEA_THRESHOLD`, `MET_ACTIVE_THRESHOLD`, `RANGE_THRESHOLD`, `NIGHT_BAND_*`,
`CONSISTENCY_*` and `LOW_CONFIDENCE_THRESHOLD`. Their inputs are per-sample intermediates that are
never persisted. That is the largest unexamined block on the scoring surface, and it feeds the sleep
score — readiness's heaviest contributor at 16%.

They are blocked on precisely what TN-2's offset fit and TN-3a/TN-4's stress term are blocked on: a
context that can run the pipeline with the daytime-stress constants present. **One admin-gated,
owner-triggered replay endpoint unlocks three items at once.** TN-2 already sketches it and explicitly
leaves it unscoped. It is Lane A work; Tuning's contribution is the list of what it must expose.

TN-52's rule 1 removes TN-2's *own* need for that endpoint — a quantile has no offset to fit — but not
the other two, so it is still worth building.

## Also confirmed, not re-found

The owner's training is invariant: **5 sessions a week, 50 of 50 completed, ten weeks straight.** Every
signal keyed to frequency variation has almost nothing to work with, which is why `ACWR_TAPER_START`
has never been reached. Already filed.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no UI.
Row-scoped to the owner.

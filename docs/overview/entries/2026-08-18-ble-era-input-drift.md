# The re-key moved two inputs, and the useful result is a refit we are not shipping

**Date:** 2026-08-18 · **Branch:** `tuning/ble-era-input-drift` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-509, Q-510

Both items come off this agent's own follow-up list rather than another lane's queue: Q-509 is the
"re-derive Q-500's anchor on BLE-era nights" item, Q-510 closes the lead Q-508 left open when the
db-query endpoint locked out mid-session.

## The refit came back, and the answer is not to use it

`readiness-composite.ts` carries a rule written *before* the data existed to test it:

> *If a BLE-only refit lands well below 5, the input changed and that is a `devices` finding, not a
> scoring one.*

There are now 42 BLE-era nights of `recovery_index_hours` where there were 15 Cloud-era ones. Running
Q-500's own zero-bias procedure on them gives an anchor of **3.31 h** against the shipped **5**. Well
below. So the rule fires, and the anchor stays.

What makes it convincing rather than merely rule-following is that **the anchor and the input moved by
the same factor**: mean hours 3.59 → 2.657 (0.74×), median 3.28 → 2.377 (0.72×), zero-bias anchor
4.63 → 3.31 (**0.715×**). A real change in the owner's recovery would move the hours while leaving the
correct anchor where it was. An anchor that must shrink by exactly the factor its input shrank by is
absorbing a multiplicative bias in the estimator — and moving it would be compensating for a broken
input at the scoring layer.

It is a level shift, not a drift: July mean 2.73 / median 2.35, August 2.56 / 2.48. The step is at the
re-key and has not moved since. The mechanism was already measured in Q-500's review — at matched
sampling density the BLE series is about twice as noisy.

Worth recording plainly: **Q-500 worked.** At the shipped anchor of 5 the contributor is mean 50.8
against 43.4 at the old 6. Nothing here argues against that change; it argues against making a second
one in the same direction two days later for a reason that turns out to be measurement.

## Resilience's missing days are a coverage gate nobody can see

All four `contributorsOk` inputs are present on **18 of 18** August days — recovery index, HRV, RHR
and the HRV baseline. A daily index is produced on **3**. So the blocker is inside `preprocessStress`,
and with a stress series present on 14 of those days, the coverage check is what is failing.

It cannot be confirmed from the database, because **neither side of that inequality is persisted**.
The stored extreme-bucket counts do not separate the cases: 08-07, 08-13 and 08-17 all carry 90
minutes of extremes and produce nothing, while 08-16 carries the same 90 and produces an index.

And `worn_hours_ble` — the field an auditor reaches for first — is **NULL on all 96 rows**, exactly as
it was recorded at 0 of 79 on 2026-08-05.

So the ask is one number: persist the coverage `preprocessStress` already computes. Only after that
is "is `minDaytimeStressHours` too strict for this wear pattern" a question anyone can answer — and it
must not be answered by lowering the constant until the score fires, which is the Q-506 mistake.

## Not exercised

No code changed and nothing ran on-device. §1's refit has **no ground truth** — Oura Cloud stops at the
re-key — so the 69.0 target is carried over from the Cloud-era nights on the assumption that the
owner's long-run mean recovery did not step-change on 2026-07-07. That assumption is load-bearing and
is stated rather than tested; the smoothing experiment proposed as the first action does not depend on
it. The §2 conclusion is **by elimination** — the four contributor gates were measured, the coverage
check is inferred as the remaining candidate, not observed failing. Every figure is the owner's
(`claude_ro` is row-scoped).

## A correction to yesterday's note

The baton recorded the db-query `Forbidden` as "sustained, different from the burst 401". It recovered
on its own a few minutes later, so it *was* the transient failure after all — the baton has been
corrected, since the wrong version would have told a successor to stop using a working endpoint.

## Postscript, same session: both recalibrations went live while this was being written

PR #77 measured that neither had reached a stored row and predicted where the first one would appear.
It appeared within the hour.

Readiness now has **1 of 96** rows stamped `v3:ri5:2026-08-18`, and the shared `model_versions` JSONB
reads `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` — so the **merge** that code was
deliberately written as held in production, which had only been argued for until now.

Sleep has no stamp, so it was verified by recomputation instead: 2026-08-17 stores **78** against a
raw weighted blend of **77.91** (old model), and 2026-08-18 stores **92** against a calibrated **92**
(new model; its raw blend is 86.07). Each day matches exactly one candidate, by 8 and 6 points. **The
step in the sleep trend falls between those two days.**

Worth stating because it is counterintuitive: 08-18's score went *up* under the new model, even though
the recalibration dropped the mean from 84.1 to 69.5. `SCORE_CALIBRATION` lifts the upper-middle, so a
genuinely good night still reads as one. Checking "did it land?" by looking for a lower number on a
good night gives the wrong answer.

95 of 96 rows remain pre-recalibration and will stay so — history is not back-filled.

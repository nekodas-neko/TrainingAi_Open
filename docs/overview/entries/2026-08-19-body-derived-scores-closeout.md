# Two derived scores I'd ticked at the pillar level, actually checked

**Date:** 2026-08-19 · **Branch:** `tuning/body-derived-closeout` · **Agent:** Tuning 🎶
**Type:** docs-only — clean results plus a Q-517 addendum

The body pillar was marked ✅ on the strength of the Body Battery range and anchor work. That was a
**pillar-level** tick, and two derived scores inside it had never been looked at. Both are checked now,
and **neither has anything to calibrate** — which is worth recording so nobody re-measures them.

## BDI — no threshold exists, so there is nothing to tune

`bdi_derived` is the breathing-disturbance index, a byproduct of the SleepNet staging pass's apnea
head, on 46 of 96 rows: median **4.15**, p75 5.10, max **10.10**, 30% of nights ≥ 5, **none ≥ 15**.
Against the clinical AHI convention that is a plausible distribution for someone without sleep apnoea.

The reason there is nothing to do is simpler than the distribution: **no threshold exists anywhere.**
Its only consumer is a debug console, which labels it *"observational, not a diagnosis"*, and the
validation layer classes it with the open-ended research metrics. It is being accumulated, not acted
on — the right treatment for a clinical-adjacent number from an ML head.

## Body composition — a published formula, matched on purpose

`body_comp` (71 rows) is a deterministic derivation from logged weight and body fat, and its only
formula — `ffm × 21.6 + 370` — is deliberately matched to Oura's `atlas` postprocessor. Same category
as cardio's Riegel exponent: re-fitting it to one person would break the external consistency it exists
to maintain.

## The byproduct worth having

Q-517 proposes flooring the adaptive-TDEE plausibility check at the user's own BMR. **That BMR is
already persisted** — `body_comp.bmr_kcal`, per day, on 71 of 96 rows, from the same function. So the
floor should read the stored value rather than recompute: it becomes *the day's* BMR rather than a
window mean, and it cannot drift from the number the body-composition card already shows.

The fallback matters more than it looks. 25 rows have no `body_comp` because there was no body-fat
reading and `bodyComposition()` returns null rather than fabricating. On those days the floor should
fall back to the **most recent snapshot**, never to the universal 1,000 — a stale BMR is far closer to
the truth than a number ~500 kcal below it.

## Not exercised

No code changed. **The BDI values were validated against nothing** — there is no sleep study and no
second device, so "plausible" means *consistent with the clinical convention*, not *verified*. A
systematically wrong apnea head would produce a plausible-looking distribution too, and this review
could not tell the difference. The apnea head itself was not examined, only its persisted output.
`body_comp`'s formula was checked against one stored row; whether the body-fat percentage feeding it is
accurate is a scale question, not a formula one. And the fallback recommendation is reasoning — the 25
rows were counted, but no replay was run showing what a stale-BMR floor would pass or block.

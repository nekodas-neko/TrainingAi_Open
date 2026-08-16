# 2026-08-15 — every remaining pillar, reviewed for model soundness

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` (restarted from `main` after #1378) ·
**Type:** review, docs-only · **Backlog:** Q-298 … Q-303 (6 entries)

Third review of the day, after the scoring pillars (#1377, Q-271…Q-284) and the six unused lenses
(#1378, Q-285…Q-296). The owner asked for every remaining pillar to get the same treatment: not
*is the code correct* but **is the model sound, and does it do anything in production?**

## Why there was a third round at all

The previous review's Lens I did **one quarter of one lens** — it measured `expectedRpe` and left
three of its own four sub-checks unrun. Running the first of those found a live bug inside a few
minutes, which is the argument for having finished the job.

## What was found

**Ten exercise logs store `estimated_1rm = 0`** (Q-298) — the value zero, beside real volume and
reps. Two clusters: five on the Q-115/Q-228 deload date, and **five on 2026-08-09 with
`exercise_deloaded = false`, consecutive over 37 minutes — one whole session**. Q-228's fix filters
on that flag, so half of these pass straight through into prescription. 2026-08-09 also logged
**1,000 error events** and carries the 0.00 h sleep row from Q-274; three domains, one heavy-fault
day, pointing at the connection-starvation class.

**Autoregulation reads missing data optimistically on the path that adds load** (Q-299).
`planned_reps` exists on 17% of sets, so `repCompletionRate` is usually null — and null gives
`missedReps = false` but `metReps = (x ?? 1) >= 1` → true. That removes a guard from "push" and adds
one to "back-off", compounding Q-289's measured −2.19 delta at the two-rep bump threshold.

**37% of sets are rushed** (Q-300), and `expectedRpe` has no rest term. This is filed with an
explicit instruction to **re-run Q-289's bucket table split by rest adherence before recalibrating
anything** — the confound may turn out to be most of that finding.

**The running baseline is written at plan creation, has zero rows, and `getRunningBaseline` has no
callers outside the repository layer** (Q-301). Twelve runs prescribed without it. Third instance of
this class after Q-270 and Q-231, which is enough to suggest a CI check.

**Adaptive TDEE has not fired once in 30 days** (Q-302) — its gate needs 10 logged days per
fortnight and production runs 1–4. The gate is right; the card never says it is dormant. And the AI
coaches on that data unqualified (Q-303).

## Two pillars came back clean, and that is the result

**Heart rate**: 57,494 samples, observed max 168 — independent corroboration of the figure Q-57
adopted over `220 − age`. `daily_zone_minutes` stores `max_hr`/`resting_hr` per row, which is exactly
the provenance discipline Q-273 asks for elsewhere. **Body**: the 17-vs-68 composition gap resolved
as benign once the column-introduction date was checked (2026-07-29), and the six tape-measure
columns at 0 of 108 are *correctly empty*, not broken. No entries filed for either — manufacturing
findings to fill a pillar would have been the wrong outcome.

**And the outcome question nobody had asked**: progressive overload is working. 10 of 12 tracked
lifts improving over 3.5 months — Bench 84 → 100 kg, Hip Thrust 98 → 157 kg. The two apparent
regressions are the Q-298 zeros, not real.

## A figure I had to correct mid-review

"41 of 76 days logged (54%)" is true in aggregate and misleading: nutrition logging is front-loaded,
and recent coverage is 1–4 days per 14. The rolling-window measurement is the honest one and is what
Q-302 rests on.

## Still open

Recorded in the review's §7 and in `projectOverview.md` so nobody assumes three reviews means
finished: the 1RM question at high reps (I4), deload *policy*, volume-landmark adherence, muscle
balance, the phase engine, and the cardio pace/HR model are all **not started**. The AI-output audit
is 8 of 117. The degradation matrix is desk-only. **"What breaks at 10 users, at 100" is unanswered
for the third time.**

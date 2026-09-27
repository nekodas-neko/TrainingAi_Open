# TN-75 — the coverage "regression" is three causes, and two of them are not defects

**Branch:** `lane-a/tn75-coverage-decomposition` · **Lane A** · docs-only.

## What I set out to do

TN-75 reports `planned_pct` coverage falling from 93% in August to 72% in September, with the
acceptance criterion *"September-onward coverage returns to August's level or better"*. I picked it
up to fix the write path. Re-measuring first — which is the standing rule — showed there is no
single write-path fault to fix.

## The measurement

Re-measured on more data than the filing had: **172 September sets, 71.5%**, so it is not
recovering on its own. **49 sets lack a plan, and all 49 are now accounted for:**

| cause | sets | what it is |
|---|---:|---|
| Bodyweight exercises | **23** | Chin-Up, Pull-Up, Hanging Leg Raise |
| The 09-06 → 09-12 window | **20** | five sessions, one set per exercise, no plan on any |
| Barbell Skull Crusher | **6** | no `style_id`, so no per-set percentages exist to record |

Splitting loaded from bodyweight inverts the headline. August: loaded **233/233 = 100%**. September:
loaded **121/147 = 82.3%**, bodyweight **2/25 = 8%**. Most of the drop is a change in what was
*trained*, not in what was *recorded* — with a real, smaller loaded regression underneath.

## Two hypotheses of mine, both killed by the data

1. **"It is just the bodyweight mix."** No. Loaded coverage itself fell from 100% to 82.3%. Had I
   stopped at the first split I would have closed this as a non-finding.
2. **"The residue is sets performed beyond the prescribed count."** No. On 09-19 the same **one**
   exercise is unplanned at set 1, set 2 *and* set 3 (4/3, 4/3, 4/3). That is the per-exercise shape
   the entry measured originally — the entry was right and my tidier explanation was wrong.

## A correction to the entry

Its proposed signature for the five-session hole — *"all carry `intensity_mode` NULL where the 2–6
September sessions carry `'deload'`"* — is true and **does not discriminate**: every session from
09-13 to 09-24 also carries NULL, and all of them have full coverage. `was_override` does not
separate them either. What does: **the window logged exactly one set per exercise** (3/3, 5/5, 4/4,
4/4, 4/4) against two per exercise on every healthy day.

## The find worth the session

**The entire loaded residue is one exercise.** Barbell Skull Crusher, 6 sets, `style_id` NULL where
every planned exercise has one — and it is the same exercise, in the same 09-25 Upper session, that
BF-200 was filed for: the owner reporting that Skull Crusher alone ignored a deload. A missing
per-exercise prescription link would explain both. BF-200 now carries that note, so whoever takes it
checks one cause instead of chasing two.

## What is left

One question — what happened in 09-06 → 09-12. Session metadata is uniform across the boundary, so
the database does not hold the answer; it needs the deploy history for those dates.

And one **product** question rather than a defect, tagged `Lane: O`: should a bodyweight exercise
carry a plan at all? `planned_pct` is a percentage of a 1RM those movements do not have. Until it is
decided, adherence coverage should be quoted over loaded sets only — otherwise every future figure
has 23 structurally-unplannable sets in its denominator.

## Verification

Docs-only, no code. `check-backlog-pointers` OK (541 entries), Custom Rules **80 of 80**.

**Not exercised:** nothing runtime — there is none here. Production was read, never written.

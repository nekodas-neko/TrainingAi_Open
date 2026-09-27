# 2026-09-26 — BF-203: meal-plan tracking, designed

Owner: *"There is a meal plan tracking feature i wanna explain and have it added."* — a plan derived
from his real numbers, estimated meals when a window passes unanswered, and the next weigh-in used to
correct what those estimates really were.

**Measuring before designing cut the scope hard.** Most of it already ships: goal-derived targets,
meal windows (`meal_types.timeStartHour/timeEndHour`), reminders with a skip action, per-slot target
macros, **`plan_meal_answers`** already tracking whether a planned meal was eaten, adherence, and
carbs already skewed around training in `meal-split.ts`. The request reduced to three additions — an
`estimated` answer state, a resolve surface, and a rolling corrector.

**The corrector is a fortnight, not a next-day adjustment, and that came from his data rather than
caution.** A 500 kcal meal is 65 g of tissue; his median daily weight swing is 200 g. He reframed it
directionally — *"they weighed higher, they likely ate more"* — which tested at r = +0.175 and 57%
direction agreement over 61 day-pairs. The sign is right; applied daily the correction would be wrong
4 times in 10. Over a fortnight the same edge is reliable, so the design is his mechanism at the
resolution where it beats the noise.

**His second question improved it.** Asking whether scale body-fat would isolate fat change tested
better: fat mass is 28% quieter and correlates at +0.217. Not a clean separation — impedance tracks
hydration, and his body fat % carries a 2.26 pp daily sd — so fat mass is primary, weight is the
agreement check, the estimator is median/trimmed, and disagreement days are dropped.

**Architecture:** the estimate is an answer against the plan meal, never a `food_logs` row, so
invented calories physically cannot reach the maintenance estimator or adaptive TDEE. The rejected
alternative is recorded with what it was better at — `BF-137` and `BF-138` are live energy-model
defects, and leaving correctness to every consumer remembering a filter is how both happened.

Spec: `docs/superpowers/specs/2026-09-26-meal-plan-tracking-design.md`. Calibration constants are
flagged as the owner's, not an implementer's, and the build is not blocked on them.

## The plan, and two corrections the code made to the spec

Phase A's plan is written: `docs/superpowers/plans/2026-09-26-meal-plan-tracking-a-estimated-answers.md`
— ten TDD tasks, the migration shipping as its own PR per the no-batching rule. BF-203 became a spec
pointer with BF-203a/b/c beneath it, the way BF-11 and Q-395 were split.

**Reading the code corrected the spec twice.** The schema comment on `plan_meal_answers` (Q-187 phase
2) states the table's actual rule — *only declines live here* — which resolved an ambiguity the spec
had flagged (the `'no'` default never materialises on its own) and **invalidated the resolve flow the
spec described**: storing `'yes'` would be *"two sources of truth for one fact"*, since "I ate it" is
derivable from the food log. So confirming an estimate writes the log and clears the estimate, and
the feature adds exactly **one** new state rather than several.

That comment also reached this design's conclusion independently, before the feature existed: keeping
unconfirmed prefills out of `food_logs` is *"what stops the day's totals counting food nobody ate,
without teaching 23 readers a new filter."*

**Plans for B and C are deliberately not written yet.** They depend on the shape A actually lands, and
writing them now would be guessing at interfaces that do not exist — the same reasoning as the
protocol's "re-verify the plan against current `main`", applied forwards.

**Two checks caught real defects during the write-up.** The plan's own self-review found three helper
functions called in Task 8 and defined nowhere (now Task 5b). And `check-backlog-pointers` rejected
`Needs:` written inline on the `Added:` bullet — where it is silently ignored — which would have left
BF-203b and BF-203c printing as READY and let someone start the corrector before the migration
existed.

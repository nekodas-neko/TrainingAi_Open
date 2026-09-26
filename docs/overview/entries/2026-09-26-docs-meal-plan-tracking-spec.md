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

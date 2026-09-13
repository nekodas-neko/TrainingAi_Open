# 2026-09-13 — BF-152: the budget should anchor to a rule, not to a number (BugFix intake)

Docs-only. The owner read the budget the morning after BF-150 shipped and asked whether exercise had
stopped counting: *"So its showing 1660 now; does that mean that excercise doesnt get coutned now?"*

## Exercise was counting; there was nothing to add yet

`budgetProvenance` returns `base + earned` and always has. He had **374 steps** at the time — about
13 kcal — so the figure was sitting on its base. Yesterday, with 2,923 steps and a strength session,
it would have moved. Nothing was broken, which is worth recording because the report reads like a
regression and is not one.

## What he actually asked for, and why it is not what shipped

*"Rmr+body metabolism as base — Calories burned per day based on HR/excercise … It should start at
1350 - and as I walk/workout - move throughout the day to 1600."*

BF-150 anchored the budget to a stored **number** (`nutrition_targets.calories` = 1,660). He is
describing a **rule**. The distinction is the entry: a typed-in figure cannot track a body that is
changing, and his is — 72.1 kg at the RMR test on 2026-08-27, 70.2 kg on 2026-09-13.

## His two figures are his own physiology, measured

| | value |
|---|---|
| measured RMR (2026-08-27, FFM 51.5 kg) | 1,325 |
| Cunningham residual | −157 |
| FFM today (70.2 kg, 25.5% corrected) | 52.3 kg |
| **re-scaled RMR today** | **1,342** |
| `bmr × 1.2` (sedentary multiplier) | **1,611** |

*"Start at 1350"* is his measured resting rate to within 8 kcal. *"Move to 1600"* is that rate plus
the classic sedentary multiplier — which is exactly the overhead he went on to name himself: *"I know
1350 doesnt count some basic metabolic needs."* He described the textbook model without reaching for
it.

The value the fix needs is already computed one scope away: `energy-balance-service.ts` derives `bmr`
as `personalRmr(measured, todaysFfm)` (BF-42). **`restingBaseKcal` is the wrong one** — on the
calibrated path it is `maintenance − avgActive`, and that maintenance is the estimator BF-137 is
about.

## The one thing left to the owner

RMR excludes the thermic effect of food (~140 kcal at his volume) and non-step NEAT. The entry
recommends crediting that through movement rather than through a multiplier — the multiplier asserts
the overhead happened, the step credit observes it — and naming the residual in the ⓘ copy instead of
modelling it. Modelling TEF as an earned credit makes the budget grow as he eats, which the card then
has to explain, for a number inside food-logging error. The entry is buildable either way and says
so.

Filed at the top of the queue. Nothing else in BF-150 changes: one budget expression across three
surfaces, the goal delta still not applied on top, `deviationKcal` still measured against the budget.

## Not exercised

Docs only. The 1,342 and 1,611 figures are computed from production rows (`measured_rmr`,
`body_metrics`) against the shipped `cunninghamBmr`, not read off a running app.

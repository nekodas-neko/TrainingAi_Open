# 2026-08-11 — Calories in vs out: one calibrated number (v1.280.0)

**Branch:** `claude/nutrition-tracking-review-eyftu1` · **Domain:** `nutrition`

The owner is moving to heavy daily nutrition tracking and asked why the calories-in-vs-out work,
which had been planned, was never visible — plus a review of the nutrition saving path and what
else could feed the AI coach.

## Root cause: the card had never rendered, on any tab

`"energyBudget"` is listed only in the Health tab's `BODY_GROUPS`, but its `case` sat in
`renderTrainingSection` — and no training order contains the key. Both tabs fell through to
`default: return null`. Not a regression; it was that way on `main`. Moved to `renderBodySection`.

## Three calculations that disagreed

- Health "Balance" tile: BMR × activity factor (1.4) **and then** minus measured movement —
  double-counting it.
- Health Energy Budget card: BMR × 1.2 + measured movement (correct, invisible).
- Nutrition macro ring: target + burn.

All three now read one server-computed payload from `lib/health/energy-balance-service.ts`. The two
superseded hooks (`useEnergyBalance`, `useEnergyBudget`) and `energy-budget-card.tsx` are deleted,
so the wrong maths cannot come back.

## Two DB columns held different targets

Production had `users.calorie_goal` = 1950 and `nutrition_targets.calories` = 1750. The 200 kcal gap
is exactly `MAX_ADJUST_KCAL` — the TDEE nudge card wrote `nutrition_targets` and never mirrored.
`nutrition_targets.calories` is now the source of truth and both write paths mirror; verified in
both directions, and verified that a calories-only write does not wipe the macros.

## Calibrated maintenance

`packages/shared/src/nutrition/adaptive-tdee.ts` estimates real maintenance from mean logged intake
against the weight slope over a rolling 28/14-day window. Gated hard: an unlogged day is a **gap**,
never a zero-calorie day (nulls-as-zeros would halve the mean and report a starvation-level
maintenance); coverage, weigh-in-span and plausibility failures return null with a reason
(*"Log food on N more days to calibrate"*) instead of a number.

**Caught mid-build:** today's *partial* intake was feeding the calibration window, which would have
made maintenance sag every morning and recover each evening. The current day is now excluded, with
a DB-backed regression test asserting maintenance does not move as today is logged. Same
partial-day trap as the Oura `wornHours` mistake.

## Bands measure against the goal, not zero

`computeCalorieBalance` bands deviation from the goal's target net (`GOAL_DAILY_DELTA`), so eating
at maintenance while cutting is "well over" and an over-aggressive deficit is "well under" — both
red. ±150 kcal is on-target (roughly the noise floor of self-reported intake for one day); ±400 is
the outer edge (~0.36 kg/week of drift if sustained).

## Also shipped

- Home widget, registered like every other card widget (toggle, colour, reorder, hide). Verified it
  shows when enabled and disappears when not.
- Replaced the nine-case `card_*` fall-through in the Home switch with one prefix guard — that list
  was why the new widget rendered nothing at first.
- `getEnergyBalance` AI tool calling the **same service**, so the coach cannot contradict the widget.
- `energy-balance:` added to six cache-invalidation groups (nutrition, body-metric, activity,
  biometrics, workout-summary, goal-recommendation).

## Verified / not verified

Nutrition CRUD exercised end-to-end against the local DB: create item, log (2× a 165 kcal item →
330 kcal / 62 g P), edit (2 → 1.5 → 248 kcal), delete, weekly rollup, food_logs overriding
body_metrics. 3493 tests, 16 custom rule checks, production build all green. Rendering confirmed at
the 412×915 S25 viewport for Nutrition, Health and Home.

**Not verified:** on-device. The sandbox renders safe-area insets as 0 and has no native SQLite, so
the new card's insets and any local-store path are unexercised — Known-Issues row added.

## Follow-ups filed

- **Q-186** Meal Plan Phase 1, with a full plan at
  [`docs/superpowers/plans/2026-08-11-meal-plan.md`](../../superpowers/plans/2026-08-11-meal-plan.md).
- **Q-187** Meal Plan Phase 2 (prefill the day's food logs), blocked on Q-186 and deliberately split
  out because it writes to `food_logs`.
- The backlog's "next free migration number" pointer had drifted five behind the directory; corrected
  to 175.

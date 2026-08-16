# 2026-08-12 — The plan card shows the day, not just the plan

**Release:** v1.296.0 · **Domain:** nutrition · **Branch:** `feat/plan-card-progress` · **Closes:** Q-200

Found by the post-merge review, not by a report — which is worth noting, because it is the kind of
thing a user would feel as "that card is useless" without ever being able to say why.

## What was wrong

`MealPlanSection` rendered the plan's targets and nothing about the day, though `nutrition-content.tsx`
has `totals` for exactly that a few lines above it. Worse, `MacroRow` drew
`<div className="h-full w-full">` inside the track — **all three bars were always 100% full**,
regardless of the grams printed beside them. A bar that is always full is worse than no bar: it
reads as a progress indicator and is not one.

## What it does now

Each bar fills to `eaten / target`, the calorie line reads `1,240 / 2,000`, and going past a target
is marked with `↑` and a weight change — never colour alone, per the standing rule.

Two smaller decisions:

- **A day with no logs shows empty bars, not full ones.** Absent is not zero — `eaten` is
  `undefined` rather than `0` when nothing is logged, so the card keeps showing plain targets rather
  than claiming a day is 0% done before it has started.
- The bars are real `role="progressbar"` elements with `aria-valuenow`/`max`, which they could not
  have been while they were decorative.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **451 files / 3,718 tests green**.

Measured in the browser at 412×915 rather than eyeballed. Empty day: all three bars at `0%` with
their labels reading `0 of 150 grams`. After logging 3× chicken breast through the API: **Protein
20%, Carbs 19.6%, Fat 10%**, matching the logged food.

## Not exercised

Not verified on device. No migration, no schema change, no sync-path change.

## Left open deliberately

**Q-201 — a plan meal's `suggestedTime` still schedules nothing.** It is stored, synced, rendered on
three surfaces and fed to the AI, and no notification comes from it. Not done here because it is a
real fork, not an implementation detail: the app's existing reminders fire at a *meal type's* end
hour as a "you didn't log this" catch-up, while a plan time is a "time to eat" prompt, and meal types
and plan meals are not 1:1. Making plan times drive the existing reminders, adding a second stream,
or leaving them as labels are three different products. Two sources for one notification is the trap
the backlog entry names, and notifications cannot be verified anywhere but the device — so this
wants an owner decision rather than a guess shipped blind.

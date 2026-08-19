# The TDEE check found the module already doing it, and a floor set 52 kcal too low

**Date:** 2026-08-18 · **Branch:** `tuning/nutrition-tdee-check` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-517

The nutrition pillar's last open item was whether the calorie target tracks the owner's observed
weight change. `adaptive-tdee.ts` already runs exactly that calculation, and its header already warns
that an ungated version *"would tell the user their maintenance is 1200 kcal — actively harmful
advice"*. So the real question became: do the gates it added actually hold?

## The input condition

The food log captures about **50%** of what the owner eats. 44 logged days of 110, mean **1,223
kcal**, 43% of logged days under 1,200, 4.8 entries per day. Against 75 weigh-ins showing a slope of
+8 g/day — an energy balance of **+62 kcal/day** — and a Cunningham BMR of **1,547** giving a
predicted TDEE of **2,397**, implied actual intake is **~2,459**.

Taking the log at face value implies a maintenance of **1,161 kcal, below the owner's own BMR of 1,547**. That
is not a slow metabolism; it is arithmetic proof of under-logging. **Nothing is filed for it** —
people log partially, and that is the condition everything else has to survive.

## The gates hold 75% of the time

Replaying every rolling window: 72 of 97 fourteen-day windows are correctly refused on coverage or
span, 2 more on plausibility, and **23 (24%) pass — with values from 1,052 to 2,219**.

Two things stand out. **`MIN_PLAUSIBLE_MAINTENANCE = 1000` sits just below the artefact**: this
owner's lands at **1,052**, clearing the floor by 52 kcal. The module's own comment predicted the
failure at 1,200 and the floor was set 200 below that prediction, so the real value slipped between
them. And the passing values span **1,167 kcal** for the same person within weeks — unstable even
where not harmful.

**Why the coverage gates cannot catch it:** `MIN_LOGGED_FRACTION` counts days that *carry* a log, not
whether each day's log is *complete*. A day with breakfast and nothing else counts as fully logged.
So a 45%-complete record passes a 70%-coverage gate. The gates measure the wrong kind of
incompleteness.

This reaches the user: `TdeeAdaptationCard` writes the accepted value through the endpoint its own
docstring calls the source of truth for the daily calorie target.

## The fix, and what it does not fix

Replace the universal 1,000 floor with **the user's own BMR**. Maintenance below BMR is impossible by
definition rather than implausible by taste, and `cunninghamBmr` is already imported in the same
package. Measured: 14-day passing windows 23 → **13**, range tightening to **1,592–2,219**; 28-day
22 → **13**, range **1,565–1,889**. Every harmful value blocked.

**It makes the estimate safe, not correct.** The survivors still sit ~500 kcal under the formula's
2,397 — residual under-logging showing through — and that should not be described as a fix for
accuracy.

Two tempting wrong turns, both recorded: **raising `MIN_LOGGED_FRACTION`** drops good windows while
keeping bad ones, because the gate structurally cannot see within-day incompleteness; and **scaling
logged intake up** by a multiplier inferred from the weight trend is circular, since maintenance is
derived from that same trend — it would reproduce the assumed TDEE and present it as a measurement.

## Not exercised

No code changed. The replay is a faithful port of the gates but **could not be validated against
stored output — no maintenance estimate is persisted**, the same limitation as the ACWR and RPE
replays. `linearFit` was re-implemented as plain least squares; the gate outcomes are dominated by
coverage counts, which don't depend on it. `activity_level: moderate` is taken from the profile as-is
— if the owner is more active, the under-logging is worse than 45%, not better. Accuracy of individual
`food_items.calories` values was not checked.

Also recorded, not filed: **`tdeeAdjustment` is dead code**, referenced only by its tests and by the
comment explaining it was replaced. Same trap as `amrapScaleFactor` in Q-514.

## Corrected 2026-08-19

Every BMR-derived figure above was first published from the **textbook** Cunningham equation
(`500 + 22 × LBM`), taken from memory. The app uses `cunninghamBmr = ffm × 21.6 + 370`
(`body-composition.ts`), deliberately matched to Oura's `atlas` postprocessor and shared with the
nutrition-goal baseline — so the published BMR was **152 kcal too high**, and that propagated into the
TDEE, the under-logging percentage and the floor test.

**The conclusion is unchanged**: the log-implied maintenance of 1,161 is still below BMR, so
under-logging is still proven, and the BMR floor still blocks every harmful value. Only the magnitudes
moved.

The lesson is the repo's own: *verify against the pinned source, not memory*. That rule is written
about external API field names, and it applies just as directly to a formula the codebase defines.

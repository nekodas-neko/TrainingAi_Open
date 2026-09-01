/**
 * The energy model's plain constants, in a module with no dependencies at all.
 *
 * It lives here rather than in `daily-energy.ts` for a reason CI found and neither `tsc` nor the
 * test suite can: `daily-energy` imports `workout-energy`, which imports `lib/oura-models/constants`,
 * which imports `node:path`. Q-401 made `goal-recommendation.ts` import this constant so the goal
 * wizard and the energy-balance model share one number — and that single import dragged `node:path`
 * into the client bundle through `calorie-balance` → `calorie-zone-bar` → the nutrition tab, failing
 * `next build` with a webpack resolve error.
 *
 * So: a leaf module. Anything that only needs a number gets it without the machinery that uses it.
 *
 * **It happened again, with a different node builtin (LB-43).** `daily-energy` → `workout-energy` →
 * `lib/oura-models/constants` also reaches `node:fs/promises`, and BF-87 took the whole Nutrition tab
 * to a 500 importing `STEP_BASELINE` for a line of **copy**. No client component had ever imported
 * `daily-energy`, so nothing had tripped it before. The stopgap was a second copy of the number in
 * `components/nutrition/movement-breakdown.ts`.
 *
 * **So the other three moved here rather than into a new file.** LB-43 proposed
 * `energy-constants.ts`; this module already was that module, created for the same failure one
 * builtin earlier, and two leaf modules for one purpose is the drift the one-formula rule is about.
 * `daily-energy.ts` re-exports all four, so every existing importer is untouched.
 */

/** Budget resting base = BMR × this. Sedentary Mifflin factor (BMR + TEF + incidental NEAT).
 *
 *  Q-401 — this is the ONLY multiplier that turns a BMR into a daily baseline. `ACTIVITY_MULTIPLIERS`
 *  used to be a second one in `goal-recommendation.ts`, folding a *self-reported* activity level into
 *  the calorie target while this model *measured* movement and added it — two budgets 274 kcal apart
 *  on one screen. Activity is only ever ADDED to this number, never multiplied into it. */
export const SEDENTARY_MULTIPLIER = 1.2

/**
 * The step count whose energy is CREDITED OUT of the formula resting base, so stepping can be
 * counted from the first step (BF-88).
 *
 * **It was `STEP_BASELINE`, a threshold, and the rename is the point.** Until 2026-09-01 the base
 * was `BMR × 1.2` and only steps *above* 3,000 earned anything — which meant a day with 1,196 steps
 * was paid for 3,000 steps' worth of incidental walking that did not happen, and the card had to
 * explain a threshold. The owner asked the right question: *"cant we remove some calories for the
 * base 3000 and have it start from 0 steps?"*
 *
 * So the same 3,000 steps are now subtracted from the base as kcal instead of skipped as steps. At
 * exactly 3,000 the two are equal and the day's total burn is **unchanged** — measured across 124
 * days, 74 unchanged exactly and every day at or above 3,000 identical to the kcal. Below it the
 * total drops, which is the intent.
 *
 * **The value did not change and its meaning did, which is why this is a rename and not an edit.**
 * A test pinning `3000` cannot notice a change of meaning; a rename breaks every consumer on
 * purpose. If you are here because the compiler sent you, read what the new name means before
 * substituting the old one back.
 *
 * **⚠ The kcal this represents is COMPUTED per user, never a constant.** It is this many steps'
 * energy at the user's own age, weight and sex — about 102 kcal for the owner, different for anyone
 * else. `stepEnergyKcal` in `daily-energy.ts` is the one place that turns it into calories.
 *
 * **⚠ It applies to the FORMULA path only.** On the calibrated path the base is
 * `maintenance − avgActiveKcal`, and lowering the step floor raises `avgActiveKcal`, so the
 * subtraction happens by itself. Applying the credit there as well double-subtracts it.
 */
export const STEP_BASE_CREDIT = 3000

/** Walking cadence for turning a step count into minutes. Tudor-Locke: ~100 steps/min ≈ the
 *  moderate-intensity walking threshold, which matches the walking MET (4.3) used by `daily-energy`. */
export const WALKING_CADENCE_SPM = 100

/** Steps per km for converting a logged outdoor activity's distance to a step-equivalent (~0.77 m
 *  stride). Used only to REMOVE steps already attributed to logged walks/runs from the passive total. */
export const STEPS_PER_KM = 1300

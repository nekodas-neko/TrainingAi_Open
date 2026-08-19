/**
 * The one baseline multiplier, in a module with no dependencies at all.
 *
 * It lives here rather than in `daily-energy.ts` for a reason CI found and neither `tsc` nor the
 * test suite can: `daily-energy` imports `workout-energy`, which imports `lib/oura-models/constants`,
 * which imports `node:path`. Q-401 made `goal-recommendation.ts` import this constant so the goal
 * wizard and the energy-balance model share one number — and that single import dragged `node:path`
 * into the client bundle through `calorie-balance` → `calorie-zone-bar` → the nutrition tab, failing
 * `next build` with a webpack resolve error.
 *
 * So: a leaf module. Anything that only needs the number gets it without the machinery that uses it.
 */

/** Budget resting base = BMR × this. Sedentary Mifflin factor (BMR + TEF + incidental NEAT).
 *
 *  Q-401 — this is the ONLY multiplier that turns a BMR into a daily baseline. `ACTIVITY_MULTIPLIERS`
 *  used to be a second one in `goal-recommendation.ts`, folding a *self-reported* activity level into
 *  the calorie target while this model *measured* movement and added it — two budgets 274 kcal apart
 *  on one screen. Activity is only ever ADDED to this number, never multiplied into it. */
export const SEDENTARY_MULTIPLIER = 1.2

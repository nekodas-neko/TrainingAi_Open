/**
 * The Atwater factors — the calories in a gram of each macronutrient.
 *
 * LB-9: these were written out longhand in four places. `calorie-balance.ts` had a `KCAL_PER_G`
 * that was not exported, `goal-recommendation.ts` hardcoded `* 4` / `* 9` at four call sites, and
 * `components/nutrition/macro-energy.ts` declared its own because it could not reach either.
 *
 * Its own module rather than an export from `calorie-balance.ts`, which is what the entry
 * suggested: a component that wants two numbers should not have to import a day's worth of
 * calorie-budget maths to get them. Six lines with no dependencies can be imported from anywhere,
 * which is the property that stops a fifth copy appearing the next time something needs them.
 *
 * Not configurable. These are physiological constants, not tuning.
 */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

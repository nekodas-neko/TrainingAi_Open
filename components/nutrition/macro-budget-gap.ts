import { macroKcal, type MacroGrams } from './macro-energy'

/**
 * How far the macro gram targets sit from the calorie budget printed beside them (BF-134).
 *
 * **The two are anchored to different baselines, and the gap NEVER closes.** The grams come from
 * stored `nutrition_targets` — a whole-day goal that already assumes a normal day's activity —
 * scaled up by what has been earned. The budget is `restingBase + goalDelta + earned`, and the
 * resting base has that habitual activity taken *out* of it so movement can be added back once as
 * it is recorded. Both addends carry the same `earned`, so it cancels: what is left is a constant
 * `storedGoal − (restingBase + goalDelta)` — **406 kcal** on the owner's account, at every hour of
 * every day.
 *
 * BF-134's own entry reads it as a gap that "converges once ~406 kcal is earned". It does not, and
 * `__tests__/macro-budget-gap.test.ts` pins that: earning the 406 moves *both* numbers. That is the
 * reason this is worth a sentence on the card rather than waiting for the day to reconcile it.
 *
 * Deciding which anchor is *right* is not this module's business — it reaches
 * `lib/health/energy-balance-service.ts` and TN-29 protects the stored 1,660. This only says out
 * loud that they are two denominators.
 */

/** Below this the two numbers read as the same one, and a paragraph explaining them is noise. */
export const MACRO_BUDGET_GAP_KCAL = 100

export interface MacroBudgetGap {
  /** What the gram targets shown on the card add up to. */
  targetKcal: number
  /** Signed: positive when the grams ask for more food than the budget allows. */
  gapKcal: number
}

/**
 * Null when there is nothing worth saying — no budget, an incomplete macro target, or a gap small
 * enough to be rounding.
 *
 * **All three macros or nothing.** A target with protein set and carbs left blank sums to less than
 * the day asks for, and reporting that shortfall as a disagreement with the budget would invent a
 * finding out of an unfinished profile.
 */
export function macroBudgetGap(
  target: Partial<MacroGrams> | null | undefined,
  budgetKcal: number | null | undefined,
): MacroBudgetGap | null {
  if (target == null || budgetKcal == null || !Number.isFinite(budgetKcal)) return null
  const { proteinG, carbsG, fatG } = target
  if (proteinG == null || carbsG == null || fatG == null) return null

  const targetKcal = Math.round(macroKcal({ proteinG, carbsG, fatG }).total)
  const gapKcal = targetKcal - Math.round(budgetKcal)
  if (Math.abs(gapKcal) < MACRO_BUDGET_GAP_KCAL) return null
  return { targetKcal, gapKcal }
}

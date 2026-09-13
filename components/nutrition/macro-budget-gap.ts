import { macroKcal, type MacroGrams } from './macro-energy'

/**
 * How far the macro gram targets sit from the calorie budget printed beside them (BF-134).
 *
 * **The two are anchored to different baselines, and the gap NEVER closes.** The grams come from
 * stored `nutrition_targets` — a whole-day goal that already assumes a normal day's activity —
 * scaled up by what has been earned. The budget is `budgetProvenance().base + earned`, where the
 * base excludes that habitual activity so movement can be added back once as it is recorded. Both
 * carry the same `earned`, so it cancels: what is left is `storedGoal − base`, constant across the
 * day.
 *
 * **⚠ BF-154: `base` is not one formula, and this comment used to state the retired one as fact.**
 * It read *"the budget is `restingBase + goalDelta + earned`"*, which is the UNANCHORED branch only.
 * Since BF-152 the base is the user's RESTING RATE wherever one is known, so on the owner's account
 * the constant moved from `storedGoal − (restingBase + goalDelta)` to `storedGoal − restingRate` —
 * a jump from ~295 to ~365 that nothing re-derived. Read `budgetProvenance`'s
 * `anchoredToRestingRate` for which branch produced the number in front of you rather than
 * reconstructing it from the balance fields; a call site doing that arithmetic itself is exactly
 * what BF-154 was filed for.
 *
 * BF-134's own entry reads it as a gap that "converges once the earned kcal arrive". It does not,
 * and `__tests__/macro-budget-gap.test.ts` pins that: earning it moves *both* numbers. That is the
 * reason this is worth a sentence on the card rather than waiting for the day to reconcile it.
 *
 * **⚠ The SIZE of that constant is not a property of this module, and an earlier version of this
 * comment pinned it at "406 kcal on the owner's account, at every hour of every day" (BF-142).**
 * Measured 2026-09-11 the card printed **295 the other way** — the sign had flipped, so the two do
 * not differ by 111. Read the formula backwards for the base and it gives **1,454 then** against
 * **~2,155 now**: the resting base has risen ~700 kcal, which is a finding about
 * `lib/health/energy-balance-service.ts` rather than about this file. The number is deliberately
 * not restated here — anything that hardcodes it inherits a figure that has already moved.
 *
 * Deciding which anchor is *right* is not this module's business — it reaches
 * `lib/health/energy-balance-service.ts` and TN-29 protects the stored 1,660. This only says out
 * loud that they are two denominators. **Whether the grams should follow the resting rate or stay
 * on the stored goal is still open after BF-154**, which fixed the sentence explaining the gap and
 * deliberately did not move the grams: that is a change to what the user is told to eat, and it
 * belongs to whoever owns the target, not to the card that prints the difference.
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

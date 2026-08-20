import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

/**
 * What the Nutrition tab's ring should be measured against for one day (Q-417, Q-323).
 *
 * **This replaces the third calorie budget.** The ring used to render
 * `nutrition_targets.calories + activeEnergyKcalToday`, where the second term was painted
 * optimistically from the local store — `activity_logs.caloriesBurned` summed, which carries no
 * strength sessions, no steps, and `null` for a Guided Walk — and was then supposed to be corrected
 * by a separate `body-metadata` fetch "moments later". Nothing sequenced the two, so whichever
 * resolved last won. On 2026-08-19 the local one did: the ring read a 2,001 kcal budget and printed
 * *"Goal reached"* at 2,014 eaten, while the Energy Balance card on the same screen said
 * *"166 kcal left"* against the real 2,180.
 *
 * The fix is not to sequence them. It is that the ring should never have been computing a budget:
 * `/api/nutrition/energy-balance` publishes one for the day being viewed, and reading it removes
 * both the race and the disagreement at once.
 *
 * **Macro grams come from `macroTargets.scaled`, not the stored row** — that is Q-323's remaining
 * half. The stored row is the rest-day floor, so on a 551 kcal day the card reported fat *over* at
 * 68/60 g when the day actually called for 85 g.
 *
 * `null` targets mean "no budget to show" rather than "fall back to the stored goal". Substituting
 * the stored goal for a derived baseline is precisely the defect Q-415 and Q-417 are.
 */
export interface RingTargets {
  /** The day's calorie budget: resting base + goal delta + what movement earned. */
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  /** kcal the day's movement added to the budget, for the card's subtitle. */
  earnedKcal: number
}

export function ringTargets(
  balance: EnergyBalanceResponse | null,
  stored: NutritionTargets | null,
): RingTargets {
  const b = balance?.balance ?? null
  if (!b) {
    // No derived baseline for this day — an incomplete profile, or the payload has not arrived.
    // The stored macro row is still the honest answer for grams (it is a target, not a budget);
    // the calorie budget is not, so it stays null rather than becoming a fourth number.
    return {
      calories: null,
      proteinG: stored?.proteinG ?? null,
      carbsG: stored?.carbsG ?? null,
      fatG: stored?.fatG ?? null,
      earnedKcal: 0,
    }
  }

  const { earned, total } = budgetProvenance({
    restingBaseKcal: b.restingBaseKcal,
    activeKcal: b.activeKcal,
    targetNetKcal: b.targetNetKcal,
  })
  const macros = balance?.macroTargets?.scaled ?? null

  return {
    calories: total,
    proteinG: macros?.proteinG ?? stored?.proteinG ?? null,
    carbsG: macros?.carbsG ?? stored?.carbsG ?? null,
    fatG: macros?.fatG ?? stored?.fatG ?? null,
    earnedKcal: earned,
  }
}

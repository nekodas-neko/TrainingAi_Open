import { ageFromDob } from '@trainingai/shared/date-utils'
import { calculateBaseline, type BaselineResult } from '@trainingai/shared/nutrition/goal-recommendation'
import type { MeasuredRmr } from '@trainingai/shared/health/body-composition'
import type { User } from '@trainingai/shared/types'

/**
 * The deterministic recommendation behind the "Recommended" affordance on the goals form (BF-101).
 *
 * There is no second formula here: this assembles the same `BaselineInput` that
 * `/api/nutrition-goals/recommend` assembles server-side and calls the same `calculateBaseline`,
 * so a Recommended value and the number the AI sheet was given as its starting point cannot
 * disagree. The AI pass still exists — it *adjusts* this baseline — which is why the two buttons
 * make different promises and both stay.
 *
 * `measuredRmr` matters more than its optionality suggests: `calculateBaseline` routes it through
 * `personalRmr` (BF-33), the same resting rate the daily energy model uses. Omitting it here would
 * quote a predicted BMR on a screen whose Health card shows a measured one — two numbers for one
 * thing, which is the defect class LA-45 and BF-99 both closed.
 */
export interface GoalBaselineInput {
  user: User | null
  latestWeightKg: number | null
  /** Already DEXA-corrected — pass `displayBodyFat`'s output, not the raw scale reading (BF-2). */
  latestBodyFatPct: number | null
  measuredRmr: MeasuredRmr | null
}

/**
 * `null` values, never guessed ones. `calculateBaseline` needs weight, height, age, sex, activity
 * level and fitness goal; given fewer it would still return numbers, computed from defaults the
 * user never chose. A button that renders one of those is worse than no button, so the whole
 * result is withheld and the caller renders nothing.
 */
export function goalBaseline(input: GoalBaselineInput): BaselineResult | null {
  const { user, latestWeightKg, latestBodyFatPct, measuredRmr } = input
  if (user == null || latestWeightKg == null) return null
  if (!user.heightCm || !user.sex || !user.activityLevel || !user.fitnessGoal) return null
  const ageYears = ageFromDob(user.dateOfBirth, new Date())
  if (ageYears == null) return null

  return calculateBaseline({
    weightKg: latestWeightKg,
    heightCm: user.heightCm,
    ageYears,
    sex: user.sex,
    activityLevel: user.activityLevel,
    fitnessGoal: user.fitnessGoal,
    bodyFatPct: latestBodyFatPct ?? undefined,
    measuredRmr,
  })
}

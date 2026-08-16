// Single source of truth for a user's daily activity goals (W-B, 2026-07-22). The Activity score,
// the home movement targets, and anything that prescribes "how much should I move today" all read
// these — so the number the card scores you against is the same number a prescription would quote.
// Reuses the canonical Mifflin-St Jeor BMR and the activity-level step map from the nutrition
// goal-recommendation (One Formula, One Place) rather than inventing a parallel set.
//
// Evidence base: WHO 2020 physical-activity guidelines (≥150 min/wk moderate ⇒ ~22 min/day; muscle
// strengthening ≥2×/wk), Paluch 2022 (step benefit plateaus ~7–8k/day), active energy scaled off BMR
// so a heavier and a lighter person aren't held to the same absolute kcal.

import { mifflinStJeorBmr, STEP_GOAL_BY_ACTIVITY } from '@trainingai/shared/nutrition/goal-recommendation'
import type { ActivityLevel } from '@trainingai/shared/types/user'

/** Fallbacks used when the profile lacks the field needed to personalise a goal. */
export const DEFAULT_STEP_GOAL = 8000
export const DEFAULT_ACTIVE_ENERGY_GOAL = 400 // kcal
/** Active-energy goal as a fraction of BMR (≈ a WHO-guideline day of deliberate movement). */
export const ACTIVE_ENERGY_BMR_FRACTION = 0.24
/** WHO ≥150 min/wk moderate ⇒ this many minutes/day of zone-2+ (vigorous counts double upstream). */
export const DEFAULT_ZONE_MINUTES_GOAL = 22
/**
 * Sessions per rolling 7 days. **5, not the WHO floor** — and this one number drives two of the
 * Activity Score's six contributors (Q-137, 2026-08-11).
 *
 * WHO asks for muscle-strengthening ≥2 days/wk. A floor is not a target: measured over 91 days the
 * owner trains **4.9×/wk**, so against a goal of 3 the ratio is 1.63 and `STRENGTH_FREQ_CURVE` caps
 * at 100 from ratio 1.0 — `strengthFreq` (weight **25**, the largest) was **exactly 100 on all 91
 * days** and had never once carried information.
 *
 * It also feeds the volume lane: `volTarget = typicalSessionVolumeKg × strengthFreqGoal`
 * (`activity-score.ts`). At 3 that target was 14,100 against a measured 25,159 weekly mean —
 * saturated too. At 5 it is 23,500, so a good week still reaches 100 while a weak week (16,843
 * measured) drops to ~72. **One value, both lanes.**
 *
 * Deliberately set AT the owner's typical rather than above it, unlike the other goals. More
 * sessions is not monotonically better, and the model already tapers the score past the ACWR
 * optimal band — a goal of 6 would have one part of the model rewarding what another punishes. At 5
 * the contributor still discriminates where it matters: 3 sessions gives ratio 0.6 → ~73.
 *
 * See `docs/activity-goal-calibration.md` before changing this.
 */
export const DEFAULT_STRENGTH_FREQ_GOAL = 5

/**
 * Target tonnage for a single strength session, in kg. **Absolute, not derived from the user's own
 * history** — that distinction is the whole of Q-190 (2026-08-11).
 *
 * The volume lane used to score against `typicalSessionVolumeKg`, the *median of the user's own
 * sessions*. Train harder, the median rises, the target rises, the score stays put — the treadmill
 * the 2026-07-22 rewrite removed from the daily-movement lane and left here.
 *
 * 5,200 measured against the owner's last 8 weeks (40 sessions: median 4,438, mean 5,032, p75
 * 6,782). With `strengthFreqGoal = 5` the weekly target is 26,000, which separates their measured
 * weeks — weak 16,843 → 65, typical 25,159 → 97, strong 31,083 → 100. The median (22,190) puts a
 * typical week at 100 and re-saturates; p75 (33,910) makes 100 unreachable.
 *
 * Deliberately NOT personalised by bodyweight. Tonnage scales with bodyweight, training age and
 * exercise selection, and there is no principled formula for it — inventing one would be the same
 * "picking numbers badly" failure in a new costume. See docs/activity-goal-calibration.md.
 */
export const DEFAULT_SESSION_VOLUME_GOAL_KG = 5200

export interface GoalProfile {
  weightKg?: number | null
  heightCm?: number | null
  ageYears?: number | null
  sex?: string | null
  activityLevel?: ActivityLevel | null
}

export interface DailyGoals {
  stepGoal: number
  activeEnergyGoal: number   // kcal
  zoneMinutesGoal: number    // minutes/day in zone 2+
  strengthFreqGoal: number   // sessions per rolling 7 days
  sessionVolumeGoalKg: number // target tonnage for one session — absolute, never the user's own median
}

/** Derive the user's daily activity goals from their profile, with evidence-based fallbacks for any
 *  missing field. Pure — no defaults leak in from elsewhere, so every reader gets the same targets. */
export function getDailyGoals(profile: GoalProfile): DailyGoals {
  const { weightKg, heightCm, ageYears, sex, activityLevel } = profile

  const stepGoal = activityLevel ? STEP_GOAL_BY_ACTIVITY[activityLevel] : DEFAULT_STEP_GOAL

  const activeEnergyGoal =
    weightKg != null && weightKg > 0 && heightCm != null && ageYears != null && sex != null
      ? Math.round(mifflinStJeorBmr(weightKg, heightCm, ageYears, sex) * ACTIVE_ENERGY_BMR_FRACTION)
      : DEFAULT_ACTIVE_ENERGY_GOAL

  return {
    stepGoal,
    activeEnergyGoal,
    zoneMinutesGoal: DEFAULT_ZONE_MINUTES_GOAL,
    strengthFreqGoal: DEFAULT_STRENGTH_FREQ_GOAL,
    sessionVolumeGoalKg: DEFAULT_SESSION_VOLUME_GOAL_KG,
  }
}

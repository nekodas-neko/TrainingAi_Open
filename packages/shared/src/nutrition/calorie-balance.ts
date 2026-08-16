// Calories in vs calories out, banded against the user's goal.
//
// One place decides what "on target" means, so the Nutrition tab, the Health tab and the AI
// coach can never disagree about whether a day was on track. The three inputs are deliberately
// separated:
//
//   maintenance  — kcal/day that holds weight steady (calibrated from data when available,
//                  Mifflin-St Jeor × sedentary + measured movement otherwise)
//   intake       — kcal eaten
//   goalDelta    — the intentional daily offset for the user's goal (−500 to lose, +300 to gain)
//
// The target net is `goalDelta`, not zero: a day at exactly maintenance is *off* target for
// someone cutting. Bands are expressed as deviation from that target so the same thresholds
// work for loss, gain, recomp and maintenance without branching.

/** Intentional daily calorie offset per goal. Re-exported from the goal recommender so the
 *  deficit the bar bands against is the same one the target was built from. */
export { CALORIE_ADJUSTMENT_BY_GOAL as GOAL_DAILY_DELTA } from './goal-recommendation'

/** kcal per kg of body mass — the standard 7700 used across the app (see tdee-adaptation). */
export { KCAL_PER_KG } from './tdee-adaptation'

export type BalanceZone = 'far_under' | 'under' | 'on_target' | 'over' | 'far_over'

/**
 * Half-width of each band, in kcal of deviation from the goal's target net.
 *
 * ±150 is roughly the noise floor of self-reported intake for a single day, so a day inside it
 * is genuinely indistinguishable from on-target and must not be shown as a miss. ±400 is about
 * 0.36 kg/week of drift if sustained — enough to matter over a fortnight, which is where the
 * outer red band starts.
 */
export const ON_TARGET_KCAL = 150
export const OUTER_KCAL = 400

export interface ZoneMeta {
  zone: BalanceZone
  /** Paired text label — never render the colour alone (colour-only state is a repo rule). */
  label: string
  color: string
}

const ZONE_META: Record<BalanceZone, Omit<ZoneMeta, 'zone'>> = {
  far_under: { label: 'Well under', color: '#ef4444' },
  under:     { label: 'Under',      color: '#f97316' },
  on_target: { label: 'On target',  color: '#22c55e' },
  over:      { label: 'Over',       color: '#f97316' },
  far_over:  { label: 'Well over',  color: '#ef4444' },
}

/** Band a deviation-from-target (kcal; negative = ate less than the goal calls for). */
export function balanceZone(deviationKcal: number): ZoneMeta {
  const zone: BalanceZone =
    deviationKcal < -OUTER_KCAL ? 'far_under'
    : deviationKcal < -ON_TARGET_KCAL ? 'under'
    : deviationKcal <= ON_TARGET_KCAL ? 'on_target'
    : deviationKcal <= OUTER_KCAL ? 'over'
    : 'far_over'
  return { zone, ...ZONE_META[zone] }
}

export interface CalorieBalanceInput {
  /** kcal/day that holds weight steady, excluding today's measured movement. */
  restingBaseKcal: number
  /** Measured active energy today (workouts + activities + steps above baseline), net of rest. */
  activeKcal: number
  /** kcal eaten today. */
  intakeKcal: number
  /** Intentional daily offset for the goal — negative to lose, positive to gain. */
  goalDeltaKcal: number
}

export interface CalorieBalanceResult {
  /** Total calories out today = resting base + measured movement. */
  expenditureKcal: number
  /** Calories in − calories out. Negative = deficit. */
  netKcal: number
  /** What net the goal calls for (= goalDeltaKcal). */
  targetNetKcal: number
  /** netKcal − targetNetKcal. Negative = eating below what the goal calls for. */
  deviationKcal: number
  /** kcal still available to eat today and land on target. Negative = already past it. */
  remainingKcal: number
  /** Weekly weight change implied by sustaining today's net. */
  projectedWeeklyKg: number
  zone: BalanceZone
  zoneLabel: string
  zoneColor: string
}

const KCAL_PER_KG_LOCAL = 7700

export function computeCalorieBalance(input: CalorieBalanceInput): CalorieBalanceResult {
  const expenditureKcal = Math.round(input.restingBaseKcal + input.activeKcal)
  const netKcal = Math.round(input.intakeKcal - expenditureKcal)
  const targetNetKcal = Math.round(input.goalDeltaKcal)
  const deviationKcal = netKcal - targetNetKcal
  const { zone, label, color } = balanceZone(deviationKcal)
  return {
    expenditureKcal,
    netKcal,
    targetNetKcal,
    deviationKcal,
    // `-0` is a legal result of negating 0 and leaks into equality checks; normalise it away.
    remainingKcal: deviationKcal === 0 ? 0 : -deviationKcal,
    projectedWeeklyKg: Math.round((netKcal * 7 / KCAL_PER_KG_LOCAL) * 100) / 100,
    zone,
    zoneLabel: label,
    zoneColor: color,
  }
}

/**
 * Marker position for the bar, 0..1 across the five bands. The bar is drawn on a fixed
 * deviation scale of ±(OUTER + ON_TARGET) so the green band always occupies the same middle
 * slice and the eye learns one layout; deviations beyond the scale clamp to the ends.
 */
export const BAR_SCALE_KCAL = OUTER_KCAL + ON_TARGET_KCAL

export function barPosition(deviationKcal: number): number {
  const clamped = Math.max(-BAR_SCALE_KCAL, Math.min(BAR_SCALE_KCAL, deviationKcal))
  return (clamped + BAR_SCALE_KCAL) / (2 * BAR_SCALE_KCAL)
}

/** The five bands as fractions of the bar width, left (well under) to right (well over). */
export function barBands(): { zone: BalanceZone; label: string; color: string; widthPct: number }[] {
  const total = 2 * BAR_SCALE_KCAL
  const outerW = ((BAR_SCALE_KCAL - OUTER_KCAL) / total) * 100
  const midW = ((OUTER_KCAL - ON_TARGET_KCAL) / total) * 100
  const centreW = ((2 * ON_TARGET_KCAL) / total) * 100
  return [
    { zone: 'far_under', ...ZONE_META.far_under, widthPct: outerW },
    { zone: 'under',     ...ZONE_META.under,     widthPct: midW },
    { zone: 'on_target', ...ZONE_META.on_target, widthPct: centreW },
    { zone: 'over',      ...ZONE_META.over,      widthPct: midW },
    { zone: 'far_over',  ...ZONE_META.far_over,  widthPct: outerW },
  ]
}

/** The daily calorie target implied by a maintenance estimate and the goal's offset. */
export function targetFromMaintenance(maintenanceKcal: number, goalDelta: number): number {
  // Never recommend below a floor that would be unsafe regardless of goal.
  return Math.max(1200, Math.round(maintenanceKcal + goalDelta))
}

/**
 * `nutrition_targets.calories` is always a DAILY figure; `users.calorie_goal` may be daily or
 * weekly depending on `users.calorie_goal_type`. The two are mirrored on every write, so the
 * conversion lives here rather than in each route — mirroring a 13,650 kcal weekly goal straight
 * into the daily macro target once made the ring demand 13,650 kcal in a day.
 */
export function goalToDailyKcal(goalKcal: number, goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? Math.round(goalKcal / 7) : Math.round(goalKcal)
}

/** Inverse of `goalToDailyKcal` — preserves the user's chosen daily/weekly display preference. */
export function dailyKcalToGoal(dailyKcal: number, goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? Math.round(dailyKcal * 7) : Math.round(dailyKcal)
}

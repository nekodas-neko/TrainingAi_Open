import { linearFit } from './strength-projection'

export function goalProgressPct(starting: number, current: number, target: number): number {
  if (starting === target) return 100
  const pct = ((current - starting) / (target - starting)) * 100
  return Math.max(0, Math.min(100, pct))
}

// Linear-regression slope of a weight series (oldest → newest), scaled to kg/week.
// Shared by the Body Weight card's short-window trend indicator and the goal-band
// check below — one formula, one place.
export function computeWeightRateKgPerWeek(weights: number[]): number | null {
  if (weights.length < 3) return null
  const fit = linearFit(weights.map((y, x) => ({ x, y })))
  return fit ? Math.round(fit.slope * 7 * 10) / 10 : null
}

export type GoalBandStatus = 'at_goal' | 'on_track' | 'too_slow' | 'too_fast' | 'wrong_direction'

export interface GoalBandResult {
  rateKgPerWeek: number | null
  status: GoalBandStatus | null
}

// Generally-accepted safe pace for intentional weight change, kg/week magnitude,
// applied regardless of gain/loss direction.
const MIN_HEALTHY_RATE_KG_PER_WEEK = 0.25
const MAX_HEALTHY_RATE_KG_PER_WEEK = 1.0

export function evaluateWeightRateVsGoalBand(
  currentWeight: number,
  targetWeightKg: number,
  rateKgPerWeek: number | null,
): GoalBandResult {
  const direction = Math.sign(targetWeightKg - currentWeight)
  if (direction === 0) return { rateKgPerWeek, status: 'at_goal' }
  if (rateKgPerWeek == null) return { rateKgPerWeek: null, status: null }
  const towardGoal = direction * rateKgPerWeek
  const magnitude = Math.abs(rateKgPerWeek)
  const status: GoalBandStatus =
    towardGoal <= 0 ? 'wrong_direction'
    : magnitude < MIN_HEALTHY_RATE_KG_PER_WEEK ? 'too_slow'
    : magnitude > MAX_HEALTHY_RATE_KG_PER_WEEK ? 'too_fast'
    : 'on_track'
  return { rateKgPerWeek, status }
}

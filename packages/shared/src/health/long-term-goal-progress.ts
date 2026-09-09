import { linearFit } from './strength-projection'

export function goalProgressPct(starting: number, current: number, target: number): number {
  if (starting === target) return 100
  const pct = ((current - starting) / (target - starting)) * 100
  return Math.max(0, Math.min(100, pct))
}

/**
 * One weigh-in. `weightKg` is optional AND nullable because the two row shapes that reach here
 * disagree: `BodyMetrics` (server) omits the field, `BodyMetaRow` (client) carries an explicit
 * null. Both mean "this day has a metric row but no weight", and the filter below treats them
 * alike — widening here beats making one caller reshape its rows to satisfy the other's type.
 */
export interface WeightPoint {
  date: string
  weightKg?: number | null
}

export interface WeightRateFit {
  /** kg/day, UNROUNDED — callers doing arithmetic on the rate use this, never the weekly figure.
   *  The error is small and the fix is free: rounding kg/week to 2 dp first moves a maintenance
   *  estimate by at most ~5 kcal/day (0.005 kg/wk ÷ 7 × 7,700). The reason to keep it unrounded is
   *  not the size of that error but that nothing downstream should inherit a display decision. */
  slopeKgPerDay: number
  /** kg/week, unrounded. Round at the point of display, not here. */
  rateKgPerWeek: number
  /** Standard error of `rateKgPerWeek`, same units — null below 3 weigh-ins, where a fit has no
   *  residual degrees of freedom and a line through two points has no spread to measure. */
  stdErrKgPerWeek: number | null
  weighIns: number
  /** Days between the first and last weigh-in. Two readings a fortnight apart and two on
   *  consecutive days are very different evidence for the same slope. */
  spanDays: number
}

/**
 * Linear-regression slope of a weight series, scaled to kg/week.
 *
 * **Fitted against each weigh-in's DAY, not its position in the array (LB-67).** Rows exist only on
 * days carrying a metric, and this owner weighs in about three days in four — so fitting the index
 * produced a slope *per reading* reported as *per day*. Measured on a 14-day window with a true
 * trend of −0.70 kg/wk: 10 readings reported −1.04 (1.48× over), 6 reported −1.76 (2.51× over).
 * That is not only wrong digits — `evaluateWeightRateVsGoalBand` calls anything past 1.0 kg/wk
 * `too_fast`, so an ordinary −0.70 rendered on Health → Body as "Faster than ideal pace" in amber.
 *
 * The x origin is the first weigh-in rather than a window start: only differences in x affect a
 * slope, so the two agree, and this needs no window handed in.
 */
export function computeWeightRateFit(points: WeightPoint[]): WeightRateFit | null {
  const weighed = points
    .filter((p): p is { date: string; weightKg: number } => p.weightKg != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (weighed.length < 2) return null

  const day0 = Date.parse(`${weighed[0].date}T00:00:00Z`)
  const xy = weighed.map(p => ({
    x: (Date.parse(`${p.date}T00:00:00Z`) - day0) / 86_400_000,
    y: p.weightKg,
  }))
  // One guard, not two: an unparseable `day0` makes every x NaN, so a separate check on it is
  // unreachable as a distinct outcome. (Verified — a mutant deleting it survived, which is what an
  // equivalent mutant looks like.)
  if (xy.some(p => Number.isNaN(p.x))) return null

  const fit = linearFit(xy)
  // Null when every reading falls on one day — a vertical stack has no slope to report, which is
  // the honest answer rather than 0.
  if (!fit) return null

  const n = xy.length
  const mx = xy.reduce((a, p) => a + p.x, 0) / n
  const varX = xy.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  const sse = xy.reduce((a, p) => a + (p.y - (fit.intercept + fit.slope * p.x)) ** 2, 0)
  const stdErrKgPerWeek = n >= 3 ? Math.sqrt(sse / (n - 2) / varX) * 7 : null

  return {
    slopeKgPerDay: fit.slope,
    rateKgPerWeek: fit.slope * 7,
    stdErrKgPerWeek,
    weighIns: n,
    spanDays: xy[n - 1].x,
  }
}

/**
 * The display figure: kg/week to one decimal, or null.
 *
 * Keeps its own three-reading floor. Two points fit a line exactly and say nothing about a trend,
 * and this feeds a coloured band on a screen — `estimateMaintenance` accepts two because its
 * output is gated by separate coverage thresholds and its consumer is arithmetic, not a label.
 */
export function computeWeightRateKgPerWeek(points: WeightPoint[]): number | null {
  const fit = computeWeightRateFit(points)
  if (!fit || fit.weighIns < 3) return null
  return Math.round(fit.rateKgPerWeek * 10) / 10
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

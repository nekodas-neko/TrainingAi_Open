import { computeWeightRateFit, type WeightPoint } from '@trainingai/shared/health/long-term-goal-progress'

/**
 * Weight response over the current dosing period, as a rate with its uncertainty (OR-102b ④).
 *
 * **The owner asked for a two-point delta and the entry corrected it, with production numbers.**
 * *"weight delta from last weight on injection day to last recorded day … with a colour showing if
 * it's too much weight loss or if it's good."* The colour is right; two points are not. Measured over
 * 87 weigh-ins across 118 days, the residual SD about the trend is **1.203 kg**, so a difference of
 * two single readings carries ±1.70 kg — **more than twice the width of the entire target band**. The
 * colour would be close to random while looking authoritative, which is worse than no colour.
 *
 * **So this reports a rate and its 95% interval, and withholds the verdict unless the WHOLE interval
 * falls on one side of a boundary.** An interval that straddles a boundary, rounded to the nearer
 * side, is exactly the authoritative-looking coin flip the measurement above rules out.
 *
 * **The rate comes from `computeWeightRateFit` and is not re-derived here.** That is LB-67's
 * estimator, and it returns `stdErrKgPerWeek` *because this needed the interval rather than the
 * point estimate* — it was added in the same pass so this would not have to invent one. Two
 * kg/week estimators already existed in this repo, one of them wrong; a third is the bug class the
 * One Formula rule exists to prevent.
 */

/** The band is a LOSS rate as a percentage of bodyweight per week. */
export const DEFAULT_BAND_PCT_PER_WEEK = { lo: 0.5, hi: 1.0 }

/**
 * The smallest residual a 0.1 kg scale can produce, in kg.
 *
 * A fixture on a perfect line measured a residual of **1.2e-13**, which passes a plain `> 0` guard
 * and then makes every difference look significant by dividing by nothing. A series that clean is
 * degenerate, not consistent.
 */
const SCALE_SD_FLOOR_KG = 0.029

/**
 * The residual SD measured across the owner's own 87 weigh-ins, used as a FLOOR while there are too
 * few readings to trust a fitted one.
 *
 * A residual SD fitted from four points is itself noisy and routinely comes out too small, which
 * would narrow the interval exactly when it should be widest. Applied as a floor rather than a
 * replacement, so a genuinely noisier series is not talked down to this number.
 */
const MEASURED_RESIDUAL_SD_KG = 1.203
const FITTED_SD_TRUSTED_AT = 10

/**
 * Two-sided 95% t-quantiles by degrees of freedom.
 *
 * **1.96 is the wrong multiplier here and not by a little.** It is the large-sample limit; a fit over
 * three weigh-ins has one degree of freedom, where the quantile is **12.7**. Using 1.96 there would
 * report an interval six times too narrow and hand out confident verdicts on three readings — the
 * failure this whole module is shaped to avoid. Indexed by df; anything past the table is close
 * enough to the limit.
 */
const T95 = [
  Infinity, 12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
]
function t95(df: number): number {
  return df <= 0 ? Infinity : df < T95.length ? T95[df] : 1.96
}

export type ResponseVerdict = 'too_fast' | 'in_band' | 'too_slow' | 'gaining'

export interface WeightResponse {
  /** Positive means losing. The sign is flipped from the fit so the band reads in the same units. */
  lossKgPerWeek: number
  /** The 95% interval on that loss rate, same sign convention. */
  loKgPerWeek: number
  hiKgPerWeek: number
  weighIns: number
  spanDays: number
  bandLoKgPerWeek: number
  bandHiKgPerWeek: number
  /**
   * Null when the interval straddles a boundary — the honest "we cannot tell yet", and the state the
   * chip greys out for. Never rounded to the nearer side.
   */
  verdict: ResponseVerdict | null
}

export interface WeightResponseInput {
  /** Weigh-ins over the dosing period, in any order. */
  points: WeightPoint[]
  /** Current bodyweight, to turn a %/week band into kg/week. Defaults to the latest weigh-in. */
  bodyweightKg?: number | null
  bandPctPerWeek?: { lo: number; hi: number }
}

/**
 * The spread of the weigh-in DATES, Σ(x − x̄)² in days².
 *
 * Computed here rather than taken from the fit because it is a property of *when* the readings were
 * taken and nothing to do with the regression — it is what converts between the fit's standard error
 * and the residual SD underneath it, which is the only handle this module needs on the fit's
 * internals.
 */
function dayVariance(dates: string[]): number | null {
  const xs = dates.map(d => Date.parse(`${d}T00:00:00Z`) / 86_400_000)
  if (xs.some(x => Number.isNaN(x))) return null
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  const sum = xs.reduce((a, x) => a + (x - mean) ** 2, 0)
  return sum > 0 ? sum : null
}

export function weightResponse(input: WeightResponseInput): WeightResponse | null {
  const { points, bandPctPerWeek = DEFAULT_BAND_PCT_PER_WEEK } = input

  const fit = computeWeightRateFit(points)
  // `stdErrKgPerWeek` is null below three readings, and an interval is the whole point of this.
  if (!fit || fit.stdErrKgPerWeek == null) return null

  const weighed = points.filter(p => p.weightKg != null)
  const varX = dayVariance(weighed.map(p => p.date))
  if (varX == null) return null

  // Back out the residual SD the fit's own standard error implies, apply the floors, and rescale.
  const sdFitted = (fit.stdErrKgPerWeek * Math.sqrt(varX)) / 7
  const floor = fit.weighIns >= FITTED_SD_TRUSTED_AT ? SCALE_SD_FLOOR_KG : MEASURED_RESIDUAL_SD_KG
  const sd = Math.max(sdFitted, floor)
  const stdErr = (sd / Math.sqrt(varX)) * 7

  const half = t95(fit.weighIns - 2) * stdErr
  if (!Number.isFinite(half)) return null

  // Positive is losing, so the band and the rate read in the same direction.
  const loss = -fit.rateKgPerWeek
  const lo = loss - half
  const hi = loss + half

  const latest = [...weighed].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weightKg ?? null
  const bodyweightKg = input.bodyweightKg ?? latest
  if (bodyweightKg == null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null

  const bandLo = (bandPctPerWeek.lo / 100) * bodyweightKg
  const bandHi = (bandPctPerWeek.hi / 100) * bodyweightKg

  return {
    lossKgPerWeek: loss,
    loKgPerWeek: lo,
    hiKgPerWeek: hi,
    weighIns: fit.weighIns,
    spanDays: fit.spanDays,
    bandLoKgPerWeek: bandLo,
    bandHiKgPerWeek: bandHi,
    verdict: verdictFor(lo, hi, bandLo, bandHi),
  }
}

/**
 * The verdict, only where the whole interval commits to one answer.
 *
 * `gaining` is separated from `too_slow` because they are different situations to be in on this
 * drug and a reader should not have to infer one from the other's absence.
 */
function verdictFor(lo: number, hi: number, bandLo: number, bandHi: number): ResponseVerdict | null {
  if (lo > bandHi) return 'too_fast'
  if (lo >= bandLo && hi <= bandHi) return 'in_band'
  if (hi < 0) return 'gaining'
  if (hi < bandLo) return 'too_slow'
  return null
}

/** `−0.42 kg/wk (95% CI −0.88 to +0.04)` — signed as weight CHANGE, which is how a reader reads it. */
export function formatRange(r: WeightResponse): string {
  const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`
  // Back to change-of-weight for display: a loss is a negative change, and the interval flips with
  // it, so the low end of the loss is the high end of the change.
  return `${signed(-r.lossKgPerWeek)} kg/wk (95% CI ${signed(-r.hiKgPerWeek)} to ${signed(-r.loKgPerWeek)}, ${Math.round(r.spanDays)} days)`
}

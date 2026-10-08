import { computeWeightRateFit, type WeightPoint } from '@trainingai/shared/health/long-term-goal-progress'
import { doseDiffers, type DoseLogEntry } from '@trainingai/shared/health/dose-change-caveat'
import { daysBetweenDateStrs, isCalendarDate, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import { iqrBand, median, quantile } from '@trainingai/shared/stats'

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

/**
 * Which of three things the card is looking at (LB-99).
 *
 * **`insufficient` and `undecided` are not the same state and were rendered as one.** `weightResponse`
 * returns null only when there is no interval to compute — under three readings, or no spread of
 * days. It returns a full result with `verdict: null` when there are plenty of readings and the
 * confidence interval simply straddles the band, which is the *designed* normal state and the reason
 * the chip is grey far more often than it is coloured.
 *
 * The card collapsed both onto *"Not enough weigh-ins yet"*, so an account with six weigh-ins in the
 * window read that it had none — directly above its own line saying *"6 weigh-ins over 5 days"*. That
 * is what BF-136's reporter saw after his vial date was corrected, and why fixing the date did not
 * clear his symptom.
 */
export type ResponseState = 'verdict' | 'undecided' | 'insufficient'

export function responseState(result: WeightResponse | null): ResponseState {
  if (!result) return 'insufficient'
  return result.verdict ? 'verdict' : 'undecided'
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Recovery response: resting HR and HRV by days since each dose (issue 2152, BF-184).
//
// **The same module on purpose.** The owner's decision (2026-09-30) was to extend this file rather
// than add a second reta module, so dose and response stay in step. Nothing here is a new estimator
// of a kind this repo already has: the baseline is `iqrBand`'s median (the readiness and sleep
// verdicts' band), the spread is `quantile`, and what counts as a CHANGE of dose is `doseDiffers`
// from the dose-change caveat. Resting HR and HRV are not recomputed — the caller hands in the
// nights it already reads (`oura_daily_summary`: `rhrLowBpm`, `hrvAvgMs`).
//
// **What it returns is numbers and a state, never a claim.** Each dose is its own cycle, aligned on
// its dose day; for every day-since-dose offset the result is the median across cycles of the
// DEVIATION from the person's own baseline, with the 25th-75th percentile range and how many cycles
// contributed. Two cycles with training load, sleep and stress uncontrolled is an observation, not
// a finding: under `RECOVERY_MIN_CYCLES` usable cycles the answer is the typed `insufficient`
// state, never zeros and never a null that reads as zero.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Fewer usable cycles than this is `insufficient`. Two is the owner's floor (issue 2152). */
export const RECOVERY_MIN_CYCLES = 2
/** A cycle needs this many nights WITH a reading of the metric inside its window to count. */
export const RECOVERY_MIN_NIGHTS_PER_CYCLE = 3
/** A cycle runs from its dose day to the day before the next dose, capped here (the last dose has
 *  no next one, and a long gap is a different regime from "between doses"). */
export const RECOVERY_MAX_CYCLE_DAYS = 14
/** Nights before the first dose needed for the baseline to be a PRE-dose reference. */
export const RECOVERY_MIN_BASELINE_NIGHTS = 5
/** An offset reached by fewer cycles than this reports its count and no centre or range. */
export const RECOVERY_MIN_CYCLES_PER_OFFSET = 2

export type RecoveryMetric = 'rhr' | 'hrv'

/** One night, keyed by the date the app keys it under. A missing reading is null, never 0. */
export interface RecoveryNight {
  date: string
  restingHr: number | null
  hrvMs: number | null
}

/** A dose-log row plus its time. `date` is the user's local `log_date` and is the dose day. */
export interface RecoveryDose extends DoseLogEntry {
  /** ISO instant, or null for a dose logged without a time (the first Retatrutide row). */
  takenAt: string | null
}

export interface RecoveryOffset {
  /** Days since the dose day: 0 is the dose day itself. */
  offset: number
  /** Cycles with a reading at this offset. */
  cycles: number
  /** Median deviation from baseline across cycles; null when `cycles` is under the per-offset floor. */
  median: number | null
  p25: number | null
  p75: number | null
}

export interface RecoveryBaseline {
  median: number
  iqr: number
  nights: number
  /** `all_nights` means fewer than `RECOVERY_MIN_BASELINE_NIGHTS` nights pre-date the first dose, so
   *  the reference includes dosed nights and the deviations read smaller than a true pre-dose
   *  reference would give. */
  source: 'before_first_dose' | 'all_nights'
}

export type MetricRecoveryResponse =
  | { state: 'insufficient'; cycles: number; neededCycles: number }
  | { state: 'ok'; cycles: number; baseline: RecoveryBaseline; offsets: RecoveryOffset[] }

export interface DoseLevelRecovery {
  /** The dose this group shares. `amount` null means no amount was logged (text, or nothing). */
  amount: number | null
  unit: string | null
  doseText: string | null
  doses: number
  /** Doses with a parseable `takenAt`. */
  timedDoses: number
  /** Doses with no time. Day-level alignment only: such a dose cannot place a dose NIGHT. */
  untimedDoses: number
  /** Timed doses whose local calendar day (in `tz`) is not their `log_date`. `log_date` still rules. */
  timeDayDisagrees: number
  rhr: MetricRecoveryResponse
  hrv: MetricRecoveryResponse
}

export interface SubstanceRecoveryResponse {
  supplementId: string
  supplementName: string
  /** One group per distinct dose, oldest first. Cycles are never pooled across groups. */
  levels: DoseLevelRecovery[]
  /** More than one dose level was logged: the groups are not comparable with each other. */
  mixedDoseLevels: boolean
}

export interface RecoveryResponseInput {
  doses: RecoveryDose[]
  nights: RecoveryNight[]
  /** The user's timezone, used only to check a dose's `takenAt` against its `log_date`. */
  tz: string
}

const dayKey = (d: string) => d.replace(/\//g, '-')
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/** Same dose level? Only like is compared with like: an amount against an amount, text against text. */
function sameLevel(a: DoseLogEntry, b: DoseLogEntry): boolean {
  if ((a.amount != null) !== (b.amount != null)) return false
  return !doseDiffers(a, b)
}

function metricResponse(
  metric: RecoveryMetric,
  cycles: string[][],
  byDate: Map<string, RecoveryNight>,
  baseline: RecoveryBaseline | null,
): MetricRecoveryResponse {
  const read = (date: string): number | null => {
    const n = byDate.get(date)
    const v = n ? (metric === 'rhr' ? n.restingHr : n.hrvMs) : null
    return finite(v) ? v : null
  }
  const usable = cycles
    .map(days => days.flatMap((d, offset) => { const value = read(d); return value === null ? [] : [{ offset, value }] }))
    .filter(readings => readings.length >= RECOVERY_MIN_NIGHTS_PER_CYCLE)

  if (!baseline || usable.length < RECOVERY_MIN_CYCLES) {
    return { state: 'insufficient', cycles: usable.length, neededCycles: RECOVERY_MIN_CYCLES }
  }

  const maxOffset = Math.max(...usable.flatMap(c => c.map(r => r.offset)))
  const offsets: RecoveryOffset[] = []
  for (let offset = 0; offset <= maxOffset; offset++) {
    const deviations = usable.flatMap(c => c.filter(r => r.offset === offset).map(r => r.value - baseline.median))
    const enough = deviations.length >= RECOVERY_MIN_CYCLES_PER_OFFSET
    offsets.push({
      offset,
      cycles: deviations.length,
      median: enough ? median(deviations) : null,
      p25: enough ? quantile(deviations, 0.25) : null,
      p75: enough ? quantile(deviations, 0.75) : null,
    })
  }
  return { state: 'ok', cycles: usable.length, baseline, offsets }
}

function baselineFor(metric: RecoveryMetric, nights: RecoveryNight[], firstDoseDate: string): RecoveryBaseline | null {
  const valuesOf = (rows: RecoveryNight[]) => rows.map(n => (metric === 'rhr' ? n.restingHr : n.hrvMs)).filter(finite)
  const pre = valuesOf(nights.filter(n => n.date < firstDoseDate))
  const source = pre.length >= RECOVERY_MIN_BASELINE_NIGHTS ? 'before_first_dose' : 'all_nights'
  const values = source === 'before_first_dose' ? pre : valuesOf(nights)
  // Multiplier 0: the band collapses to the interquartile range itself, so the spread is the
  // readiness verdict's definition without a second quantile routine.
  const band = iqrBand(values, 0)
  return band ? { median: band.median, iqr: band.high - band.low, nights: values.length, source } : null
}

/**
 * Resting HR and HRV by days since each dose, per substance and per dose level.
 *
 * - **Cycle = one dose.** Day 0 is the dose day (`log_date`, the user's local day); the cycle runs
 *   to the day before that substance's next dose, at most `RECOVERY_MAX_CYCLE_DAYS`.
 * - **Alignment is day-level for every dose.** A timed dose could place the dose NIGHT, but the
 *   first Retatrutide row has no `takenAt`, and mixing the two alignments would put one offset on
 *   different nights. Timed and untimed counts are returned so the reader knows which they have.
 * - **Never pooled across a dose change.** Cycles group by `doseDiffers` (the caveat module's
 *   definition of a change); `mixedDoseLevels` flags a substance with more than one group.
 * - **Baseline** is the median of nights BEFORE the substance's first dose when there are
 *   `RECOVERY_MIN_BASELINE_NIGHTS` of them (so a cycle never helps judge itself), otherwise the
 *   median of all nights, marked `all_nights`.
 * - **A missing night is a gap**: skipped, never counted as 0.
 */
export function recoveryResponse(input: RecoveryResponseInput): SubstanceRecoveryResponse[] {
  const nights = input.nights
    .map(n => ({ ...n, date: dayKey(n.date) }))
    .filter(n => isCalendarDate(n.date))
    .sort((a, b) => a.date.localeCompare(b.date))
  const byDate = new Map(nights.map(n => [n.date, n]))

  const doses = input.doses
    .map(d => ({ ...d, date: dayKey(d.date) }))
    .filter(d => isCalendarDate(d.date))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.takenAt ?? '').localeCompare(b.takenAt ?? ''))

  const bySubstance = new Map<string, typeof doses>()
  for (const d of doses) {
    const list = bySubstance.get(d.supplementId) ?? []
    // Two logs on one day are one dose day (the first stands), not two cycles.
    if (!list.some(x => x.date === d.date)) list.push(d)
    bySubstance.set(d.supplementId, list)
  }

  const out: SubstanceRecoveryResponse[] = []
  for (const [supplementId, list] of bySubstance) {
    const baselines = { rhr: baselineFor('rhr', nights, list[0].date), hrv: baselineFor('hrv', nights, list[0].date) }
    const groups: { rep: DoseLogEntry; members: { dose: (typeof list)[number]; days: string[] }[] }[] = []
    list.forEach((dose, i) => {
      const gap = i + 1 < list.length ? daysBetweenDateStrs(dose.date, list[i + 1].date) : RECOVERY_MAX_CYCLE_DAYS
      const days = Array.from({ length: Math.min(gap, RECOVERY_MAX_CYCLE_DAYS) }, (_, k) => shiftDateStr(dose.date, k))
      let group = groups.find(g => sameLevel(g.rep, dose))
      if (!group) groups.push((group = { rep: dose, members: [] }))
      group.members.push({ dose, days })
    })

    const levels: DoseLevelRecovery[] = groups.map(g => {
      const cycles = g.members.map(m => m.days)
      const timed = g.members.filter(m => m.dose.takenAt && !Number.isNaN(Date.parse(m.dose.takenAt)))
      return {
        amount: g.rep.amount,
        unit: g.rep.unit,
        doseText: g.rep.doseText,
        doses: g.members.length,
        timedDoses: timed.length,
        untimedDoses: g.members.length - timed.length,
        timeDayDisagrees: timed.filter(m => toAestDay(new Date(m.dose.takenAt as string), input.tz) !== m.dose.date).length,
        rhr: metricResponse('rhr', cycles, byDate, baselines.rhr),
        hrv: metricResponse('hrv', cycles, byDate, baselines.hrv),
      }
    })
    out.push({ supplementId, supplementName: list[0].supplementName, levels, mixedDoseLevels: levels.length > 1 })
  }
  return out.sort((a, b) => a.supplementName.localeCompare(b.supplementName) || a.supplementId.localeCompare(b.supplementId))
}

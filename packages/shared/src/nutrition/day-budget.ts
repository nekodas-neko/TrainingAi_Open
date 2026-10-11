// The INPUTS to `calorieBudget` for one day, assembled once (#2690).
//
// `computeEnergyBalance` builds today's budget and `lib/achievements.ts` rebuilds every past day's, and
// the owner's rule is that a past day is judged against the budget that day would have shown. Two
// assemblies of "which weight, which resting rate, which movement" would be two budgets, so both read
// these helpers and `calorieBudget` stays the one formula.
//
// Pure: no I/O and no clock. The caller resolves the day's local midnight and hands in rows.

import { shiftDateStr, ageFromDob, dateStrMidnightInTz } from '../date-utils'
import { computeActiveEnergy, stepEnergyKcal, STEP_BASE_CREDIT, type ActiveEnergyResult } from '../health/daily-energy'
import type { Sex } from '../health/workout-energy'
import { mifflinStJeorBmr } from './goal-recommendation'
import { personalRmr, bodyComposition, type BodyComposition } from '../health/body-composition'
import { correctBodyFatPct, type BodyFatCalibration } from '../health/body-fat-calibration'
import { goalDeficitKcal, calorieBudget } from './calorie-budget'
import { MAX_WINDOW_DAYS } from './adaptive-tdee'
import { computeTrendWeightKg, weightTrendWindowStart } from '../health/long-term-goal-progress'
import type { FitnessGoal } from '../types/user'

export interface BudgetBodyMetric {
  date: string
  weightKg?: number | null
  bodyFatPct?: number | null
  bodyFatSource?: string | null
  steps?: number | null
}

export interface BudgetProfile {
  heightCm: number | null
  ageYears: number | null
  sex: Sex | null
}

/** The first date a day's budget reads body metrics from: whichever of the maintenance window and the
 *  Weight Trend window starts first. A weigh-in older than this does not reach the budget. */
export function budgetMetricsStart(date: string): string {
  const windowStart = shiftDateStr(date, -MAX_WINDOW_DAYS)
  const trendStart = weightTrendWindowStart(date)
  return trendStart < windowStart ? trendStart : windowStart
}

/** Only the rows the day's budget may read: `[budgetMetricsStart(date), date]`. */
export function budgetMetricsFor<T extends BudgetBodyMetric>(metrics: readonly T[], date: string): T[] {
  const start = budgetMetricsStart(date)
  return metrics.filter(m => m.date >= start && m.date <= date)
}

export interface DayBody {
  /** Last weigh-in in the window, however old within it. */
  latestWeightKg: number | null
  /** The latest body-fat reading, DEXA-corrected per instrument (BF-2). */
  latestBodyFatPct: number | null
}

/** `metrics` already windowed with `budgetMetricsFor`. */
export function dayBody(metrics: readonly BudgetBodyMetric[], calibration: BodyFatCalibration | null | undefined): DayBody {
  const byDateDesc = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date)
  const latestWeightKg = metrics.filter(m => m.weightKg != null).sort(byDateDesc)[0]?.weightKg ?? null
  // BF-2: the scale's BIA estimate is corrected against the DEXA before anything derives from it.
  // The correction is per instrument, so the row's own provenance decides — a reading from an
  // uncalibrated or unrecorded source is left alone rather than corrected on a guess.
  const latestBodyFatRow = metrics.filter(m => m.bodyFatPct != null).sort(byDateDesc)[0] ?? null
  const latestBodyFatPct = correctBodyFatPct(
    latestBodyFatRow?.bodyFatPct ?? null,
    latestBodyFatRow?.bodyFatSource ?? null,
    calibration,
  )?.pct ?? null
  return { latestWeightKg, latestBodyFatPct }
}

/** The profile fields a budget cannot be built without, by name. Empty = a budget exists. */
export function missingBudgetProfileFields(latestWeightKg: number | null, profile: BudgetProfile): string[] {
  return [
    latestWeightKg == null ? 'weight' : null,
    profile.heightCm == null ? 'height' : null,
    profile.ageYears == null ? 'date of birth' : null,
    profile.sex == null ? 'sex' : null,
  ].filter((f): f is string => f != null)
}

export interface RestingRate {
  comp: BodyComposition | null
  /** The measured RMR re-scaled onto this day's fat-free mass, or null when none applies. */
  measuredBmr: number | null
  /** Unrounded. The measurement when there is one, Katch-McArdle with a plausible body fat, Mifflin
   *  otherwise. */
  bmr: number
}

/**
 * The resting rate that anchors the budget. Call only when `missingBudgetProfileFields` is empty.
 *
 * Katch-McArdle when body fat is known and plausible (it beats Mifflin away from average composition),
 * Mifflin-St Jeor otherwise — matching calculateBaseline's choice. Routed through `bodyComposition`,
 * the one place the body-fat plausibility band lives (Q-527).
 *
 * BF-42: a clinically measured resting rate outranks any prediction. `personalRmr` re-scales the
 * measurement's residual onto the day's fat-free mass, which comes from the DEXA-corrected body fat —
 * the same instrument `ffm_kg_at_test` came from.
 */
export function restingRateFor(
  body: DayBody,
  profile: BudgetProfile,
  measuredRmr: { rmrKcal: number; ffmKgAtTest: number | null } | null | undefined,
): RestingRate {
  const comp = bodyComposition(body.latestWeightKg, body.latestBodyFatPct)
  const measuredBmr = personalRmr(
    measuredRmr ? { rmrKcal: measuredRmr.rmrKcal, ffmKgAtTest: measuredRmr.ffmKgAtTest } : null,
    comp?.ffmKg ?? null,
  )
  const bmr = measuredBmr ?? (comp != null
    ? comp.bmrKcal
    : mifflinStJeorBmr(body.latestWeightKg!, profile.heightCm!, profile.ageYears!, profile.sex!))
  return { comp, measuredBmr, bmr }
}

export interface BudgetDeficit {
  /** Rounded once, here, so the figure on the wire is the one the budget was built with. */
  deficitKcal: number
  deficitWeightKg: number | null
  deficitWeightSource: 'trend' | 'latest' | null
}

/**
 * #2071 (b). The budget's deficit, derived from the goal and the SMOOTHED 30-day trend weight — the
 * Body screen's Weight Trend line read at its latest weigh-in. With fewer than three weigh-ins in the
 * window there is no trend, and the latest weigh-in is used instead.
 */
export function budgetDeficitFor(input: {
  metrics: readonly BudgetBodyMetric[]
  date: string
  latestWeightKg: number | null
  goal: FitnessGoal | null
  targetWeightKg: number | null
}): BudgetDeficit {
  const trendStart = weightTrendWindowStart(input.date)
  const trendWeightKg = computeTrendWeightKg(input.metrics.filter(m => m.date >= trendStart && m.date <= input.date))
  const deficitWeightKg = trendWeightKg ?? input.latestWeightKg
  const deficitWeightSource: 'trend' | 'latest' | null =
    trendWeightKg != null ? 'trend' : input.latestWeightKg != null ? 'latest' : null
  const deficitKcal = Math.round(goalDeficitKcal({
    goal: input.goal, currentWeightKg: deficitWeightKg, targetWeightKg: input.targetWeightKg,
  }))
  return { deficitKcal, deficitWeightKg, deficitWeightSource }
}

export interface BudgetWorkout {
  id: string
  startedAt: Date
  completedAt?: Date | null
  sessionRpe?: number | null
}

export interface BudgetActivity {
  date: string
  activityType: string
  durationMin?: number | null
  distanceKm?: number | null
}

/** The day's measured movement: completed strength sessions that started that local day, the day's
 *  logged activities and its pedometer steps. `dayStartUtc` is the day's local midnight. */
export function activeEnergyForDay(input: {
  day: string
  dayStartUtc: Date
  profile: { ageYears: number | null; weightKg: number | null; sex: Sex | null }
  workouts: readonly BudgetWorkout[]
  avgBpmBySession: ReadonlyMap<string, number>
  activities: readonly BudgetActivity[]
  steps: number | null
}): ActiveEnergyResult {
  const start = input.dayStartUtc
  const end = new Date(start.getTime() + 86_400_000)
  return computeActiveEnergy({
    profile: input.profile,
    strengthSessions: input.workouts
      .filter(ws => ws.completedAt != null && ws.startedAt >= start && ws.startedAt < end)
      // `id` threads through so `workoutKcalBySession` can come back keyed by the session (Q-391).
      .map(ws => ({
        id: ws.id,
        durationMin: (ws.completedAt!.getTime() - ws.startedAt.getTime()) / 60000,
        rpe: ws.sessionRpe ?? null,
        avgBpm: input.avgBpmBySession.get(ws.id) ?? null,
      })),
    activities: input.activities
      .filter(a => a.date === input.day)
      .map(a => ({ activityType: a.activityType, durationMin: a.durationMin ?? null, distanceKm: a.distanceKm ?? null })),
    pedometerSteps: input.steps,
  })
}

export interface PastDayBudgetInput {
  /** The local days to build a budget for. */
  days: readonly string[]
  tz: string
  /** Every body-metric row from `budgetMetricsStart(earliest day)` to the latest day. */
  metrics: readonly BudgetBodyMetric[]
  bodyFatCalibration: BodyFatCalibration | null
  /** Every measured RMR, any order. A day uses the latest one measured on or before it. */
  measuredRmrs: readonly { measuredOn: string; rmrKcal: number; ffmKgAtTest: number | null }[]
  heightCm: number | null
  dateOfBirth: string | null
  sex: Sex | null
  goal: FitnessGoal | null
  targetWeightKg: number | null
  /** `ownTargetFromGoals(...)`. */
  ownTargetKcal: number | null
  workouts: readonly BudgetWorkout[]
  avgBpmBySession: ReadonlyMap<string, number>
  activities: readonly BudgetActivity[]
}

/**
 * #2690. The budget each past day would have shown, `calorieBudget(...).totalKcal`: that day's
 * resting rate, deficit and movement from the rows stored for it. Null for a day the profile cannot
 * support (no weigh-in in its window, or no height, birth date or sex), so the caller decides what
 * such a day is judged against.
 *
 * Recomputed, not stored, and the choice is deliberate: every input is already stored per day, so
 * nothing needs a migration, and a correction to a weigh-in or a workout reaches the past days it
 * belongs to instead of leaving a frozen number behind.
 *
 * What it cannot recover, because nothing records its history: the goal, the goal weight and the own
 * target are TODAY's. A day before an own target was set is judged against it. Each day uses its own
 * age, its own window's weigh-ins and the measured RMR that existed on it.
 */
export function calorieBudgetsByDay(input: PastDayBudgetInput): Map<string, number | null> {
  const out = new Map<string, number | null>()
  const metricByDate = new Map(input.metrics.map(m => [m.date, m]))
  const rmrs = [...input.measuredRmrs].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn))
  for (const day of input.days) {
    const windowed = budgetMetricsFor(input.metrics, day)
    const body = dayBody(windowed, input.bodyFatCalibration)
    // Age on the day itself: noon UTC sits on the same calendar date in every timezone this app has.
    const ageYears = ageFromDob(input.dateOfBirth, new Date(`${day}T12:00:00Z`))
    const profile: BudgetProfile = { heightCm: input.heightCm, ageYears, sex: input.sex }
    if (missingBudgetProfileFields(body.latestWeightKg, profile).length > 0) {
      out.set(day, null)
      continue
    }
    const measured = rmrs.find(r => r.measuredOn <= day) ?? null
    const { bmr } = restingRateFor(body, profile, measured)
    const { deficitKcal } = budgetDeficitFor({
      metrics: windowed, date: day, latestWeightKg: body.latestWeightKg,
      goal: input.goal, targetWeightKg: input.targetWeightKg,
    })
    const energyProfile = { ageYears, weightKg: body.latestWeightKg, sex: input.sex }
    const active = activeEnergyForDay({
      day, dayStartUtc: dateStrMidnightInTz(day, input.tz), profile: energyProfile,
      workouts: input.workouts, avgBpmBySession: input.avgBpmBySession, activities: input.activities,
      steps: metricByDate.get(day)?.steps ?? null,
    })
    out.set(day, calorieBudget({
      // Rounded as the live balance rounds it (`restingRateKcal: Math.round(bmr)`), so a past day and
      // the screen that day agree to the kcal.
      rmrKcal: Math.round(bmr),
      deficitKcal,
      movementKcal: active.total,
      stepCreditKcal: stepEnergyKcal(energyProfile, STEP_BASE_CREDIT),
      ownTargetKcal: input.ownTargetKcal,
    }).totalKcal)
  }
  return out
}

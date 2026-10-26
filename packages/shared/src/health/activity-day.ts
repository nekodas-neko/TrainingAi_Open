import { ageFromDob, dateStrMidnightInTz, shiftDateStr } from '../date-utils'
import { computeVolumeAcwr, acwrBaselineDaysRemaining, type AcwrResult, type ProgramAgeInput } from '../ai-periodization/acwr'
import { computeActivityScore, strengthWindowEndingAt, type ActivityScoreResult } from './activity-score'
import { getDailyGoals, type DailyGoals, type GoalProfile } from './daily-goals'
import { hrMaxFromAge } from './hr-zones'
import { latestWeightKg } from './latest-weight'
import { intradayHrContributors } from './intraday-hr-contributors'
import { excludeLowWearDays } from './wear-confidence'
import { rowsOfDeviceInUse, perDeviceNormal } from './per-device-normal'
import { BASELINE_MIN_NIGHTS } from './readiness-composite'

/** Qualifying days before the 28-day resting-HR mean is trusted (the readiness payload's rule). */
const RESTING_HR_BASELINE_MIN_DAYS = 5

/**
 * The 28-day resting-HR baseline, low-wear days excluded: the floor of the zone-minute lane, and the
 * readiness payload's own `baselineRhr`. One definition, so the live score and a finalised day agree.
 *
 * Per device (#3001): the rows are those of the device that measured the newest night, so an Oura
 * week is never judged against a baseline pooled with the ring's differently measured nights. Until
 * that device has `RESTING_HR_BASELINE_MIN_DAYS` days the baseline is null, not the other device's.
 */
export function restingHrBaseline<T extends { date: string; restingHeartRate?: number | null; restingHeartRateSource?: string | null }>(
  bodyMetrics: T[],
  ouraByDate: Map<string, { nonWearTimeSec?: number | null }>,
): number | null {
  const onDevice = rowsOfDeviceInUse(bodyMetrics, m => m.restingHeartRate, m => m.restingHeartRateSource)
  const rows = excludeLowWearDays(onDevice, ouraByDate)
  return rows.length >= RESTING_HR_BASELINE_MIN_DAYS
    ? rows.reduce((s, m) => s + m.restingHeartRate!, 0) / rows.length
    : null
}

/**
 * The resting HR the zone lane reads while the device in use has no baseline of its own yet: the
 * previous device's mature mean (the one the HR zones already hold still on), or null when there is
 * no previous device. Without it the zone minutes and move hours drop for the first nights on a new
 * device. Only for the zone lane; the displayed baseline stays null while the device warms up.
 */
export function carriedOverRestingHr(
  bodyMetrics: readonly { date: string; restingHeartRate?: number | null; restingHeartRateSource?: string | null }[],
): number | null {
  const carried = perDeviceNormal(
    bodyMetrics.map(m => ({
      date: m.date,
      value: m.restingHeartRate != null && m.restingHeartRate > 0 ? m.restingHeartRate : null,
      source: m.restingHeartRateSource,
    })),
    { minNights: BASELINE_MIN_NIGHTS },
  ).carriedOver
  return carried == null ? null : Math.round(carried.value)
}

export interface ActivityDayInput {
  /** The local day being scored, `YYYY-MM-DD`. */
  date: string
  tz: string
  /** Body-metric rows ending on `date`; rows after it are ignored. */
  bodyMetrics: readonly { date: string; steps?: number | null; activeCalories?: number | null; weightKg?: number | null }[]
  /** `restingHrBaseline` over the 28 days ending on `date`. */
  restingHrBaseline: number | null
  /** `carriedOverRestingHr` when the device in use has no baseline yet; the zone lane reads it then. */
  restingHrCarriedOver?: number | null
  /** The day's intraday heart rate, `[local midnight, next local midnight)`. */
  hrRows: readonly { timestamp: Date; bpm: number; source?: string | null }[]
  /** The HR profile's ceiling; null falls back to the age formula. */
  maxHr: number | null
  /** Workout sessions covering at least the 28 days before `date`; later ones are ignored. */
  sessions: readonly { startedAt: string | Date; exercises: { volume?: number | null }[] }[]
  program: ProgramAgeInput | null
  user: { dateOfBirth?: string | null; heightCm?: number | null; sex?: string | null; activityLevel?: GoalProfile['activityLevel'] } | null
  stepsGoal: number | null
}

export interface ActivityDay {
  result: ActivityScoreResult | null
  goals: DailyGoals
  /** The ACWR the taper read; null while the program is younger than the chronic window. */
  acwr: number | null
  load: AcwrResult
  signals: {
    steps: number | null
    activeCalories: number | null
    zoneMinutes: number | null
    moveHours: number | null
    moveHoursGoal: number | null
    strengthSessionToday: boolean
    sessions7d: number
    volume7dKg: number
  }
}

/**
 * One local day's Activity score, from that day's inputs (#2435).
 *
 * This used to be inline in `buildReadinessPayload` and could only score "today", so the stored
 * score of a day was whatever its in-progress value was the last time the app was opened. The same
 * function now scores today live and a finished day once, so the two can't drift. Every window is
 * bounded at the end of `date`, so a later session or reading never leaks into a finished day.
 */
export function scoreActivityForDay(input: ActivityDayInput): ActivityDay {
  const { date, tz } = input
  const dayMid = dateStrMidnightInTz(date, tz)
  const nextMid = dateStrMidnightInTz(shiftDateStr(date, 1), tz)

  const metricsToDay = input.bodyMetrics.filter(m => m.date <= date)
  const dayMetrics = metricsToDay.find(m => m.date === date) ?? null
  const weightKg = latestWeightKg(metricsToDay, date)
  const ageYears = ageFromDob(input.user?.dateOfBirth, dayMid)
  const goals = getDailyGoals({
    weightKg,
    heightCm: input.user?.heightCm ?? null,
    ageYears,
    sex: input.user?.sex ?? null,
    activityLevel: input.user?.activityLevel ?? null,
    stepsGoal: input.stepsGoal,
  })

  const sessionsToDay = input.sessions.filter(ws => new Date(ws.startedAt).getTime() < nextMid.getTime())
  const volumeOf = (ws: { exercises: { volume?: number | null }[] }) => ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
  const load = computeVolumeAcwr(
    sessionsToDay.map(ws => ({ startedAt: new Date(ws.startedAt), volumeKg: volumeOf(ws) })),
    dayMid,
    { tz },
  )
  // Skip ACWR for the first 28 days of a program: the chronic baseline is not valid yet.
  const acwr = acwrBaselineDaysRemaining(input.program, dayMid) > 0 ? null : load.acwr

  // The rolling strength window, through the helper every other reader of it uses.
  const { sessions7d, volume7dKg } = strengthWindowEndingAt(sessionsToDay, date, tz)
  const strengthSessionToday = sessionsToDay.some(ws => new Date(ws.startedAt).getTime() >= dayMid.getTime())

  // #2437: a sparse Health Connect hour is missing, not low (`intradayHrContributors`).
  let zoneMinutes: number | null = null
  let moveHours: number | null = null
  let moveHoursGoal: number | null = null
  const zoneRestingHr = input.restingHrBaseline ?? input.restingHrCarriedOver ?? null
  if (zoneRestingHr != null && input.hrRows.length > 0) {
    const c = intradayHrContributors({
      hrRows: input.hrRows,
      maxHr: input.maxHr ?? hrMaxFromAge(ageYears),
      restingHr: zoneRestingHr,
      tz,
      dateIso: date,
    })
    zoneMinutes = c.zoneMinutes
    moveHours = c.moveHours
    moveHoursGoal = c.moveHoursGoal
  }

  const signals = {
    steps: dayMetrics?.steps ?? null,
    activeCalories: dayMetrics?.activeCalories ?? null,
    zoneMinutes,
    moveHours,
    moveHoursGoal,
    strengthSessionToday,
    sessions7d,
    volume7dKg,
  }
  const result = computeActivityScore({ ...signals, goals, acwr })
  return { result, goals, acwr, load, signals }
}

/**
 * The stored `activity_contributors` for a scored day: the components, plus what makes the stored
 * score re-derivable from the row alone (`preTaper`, and `acwr`, the taper's only input), plus the
 * pre-re-key blend wrapper (Q-526). `finalisedAt` (epoch ms) is written only by the finalise, after
 * the day has ended, and is what tells a final value from a partial one.
 */
export function activityContributorsRow(day: ActivityDay, finalisedAt: number): Record<string, number | null> {
  const score = day.result?.score ?? null
  return {
    ...(day.result?.components ?? {}),
    preTaper: day.result?.preTaperScore ?? null,
    acwr: day.acwr ?? null,
    base: score,
    adjustment: 0,
    trained: day.load.todayVolumeKg > 0 ? 1 : 0,
    finalisedAt,
  }
}

/** When a stored day's Activity score was finalised, or null if it never was (a partial value). */
export function activityFinalisedAt(contributors: unknown): Date | null {
  if (contributors == null || typeof contributors !== 'object') return null
  const at = (contributors as Record<string, unknown>).finalisedAt
  return typeof at === 'number' && Number.isFinite(at) ? new Date(at) : null
}

/** A finalised day's pre-taper score, which readiness reads; null when the day is not final. */
export function finalisedPreTaper(contributors: unknown): number | null {
  if (activityFinalisedAt(contributors) == null) return null
  const v = (contributors as Record<string, unknown>).preTaper
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

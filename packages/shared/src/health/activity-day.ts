import { ageFromDob, dateStrMidnightInTz, shiftDateStr } from '../date-utils'
import { computeVolumeAcwr, acwrBaselineDaysRemaining, type AcwrResult, type ProgramAgeInput } from '../ai-periodization/acwr'
import { computeActivityScore, type ActivityScoreResult } from './activity-score'
import { getDailyGoals, type DailyGoals, type GoalProfile } from './daily-goals'
import { hrMaxFromAge } from './hr-zones'
import { intradayHrContributors } from './intraday-hr-contributors'
import { excludeLowWearDays } from './wear-confidence'

/** Qualifying days before the 28-day resting-HR mean is trusted (the readiness payload's rule). */
const RESTING_HR_BASELINE_MIN_DAYS = 5

/**
 * The 28-day resting-HR baseline, low-wear days excluded: the floor of the zone-minute lane, and the
 * readiness payload's own `baselineRhr`. One definition, so the live score and a finalised day agree.
 */
export function restingHrBaseline<T extends { date: string; restingHeartRate?: number | null }>(
  bodyMetrics: T[],
  ouraByDate: Map<string, { nonWearTimeSec?: number | null }>,
): number | null {
  const rows = excludeLowWearDays(bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0), ouraByDate)
  return rows.length >= RESTING_HR_BASELINE_MIN_DAYS
    ? rows.reduce((s, m) => s + m.restingHeartRate!, 0) / rows.length
    : null
}

export interface ActivityDayInput {
  /** The local day being scored, `YYYY-MM-DD`. */
  date: string
  tz: string
  /** Body-metric rows ending on `date`; rows after it are ignored. */
  bodyMetrics: readonly { date: string; steps?: number | null; activeCalories?: number | null; weightKg?: number | null }[]
  /** `restingHrBaseline` over the 28 days ending on `date`. */
  restingHrBaseline: number | null
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
  const weekFrom = dateStrMidnightInTz(shiftDateStr(date, -7), tz)

  const metricsToDay = input.bodyMetrics.filter(m => m.date <= date)
  const dayMetrics = metricsToDay.find(m => m.date === date) ?? null
  const latestWeightKg = [...metricsToDay].reverse().find(m => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null
  const ageYears = ageFromDob(input.user?.dateOfBirth, dayMid)
  const goals = getDailyGoals({
    weightKg: latestWeightKg,
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

  // Rolling 7-day strength window, inclusive of the day.
  const sessions7dRows = sessionsToDay.filter(ws => new Date(ws.startedAt).getTime() >= weekFrom.getTime())
  const strengthSessionToday = sessionsToDay.some(ws => new Date(ws.startedAt).getTime() >= dayMid.getTime())
  const volume7dKg = sessions7dRows.reduce((s, ws) => s + volumeOf(ws), 0)

  // #2437: a sparse Health Connect hour is missing, not low (`intradayHrContributors`).
  let zoneMinutes: number | null = null
  let moveHours: number | null = null
  let moveHoursGoal: number | null = null
  if (input.restingHrBaseline != null && input.hrRows.length > 0) {
    const c = intradayHrContributors({
      hrRows: input.hrRows,
      maxHr: input.maxHr ?? hrMaxFromAge(ageYears),
      restingHr: input.restingHrBaseline,
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
    sessions7d: sessions7dRows.length,
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

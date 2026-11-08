import { ageFromDob, dateStrMidnightInTz, shiftDateStr, todayInTz } from '../date-utils'
import { computeVolumeAcwr, acwrBaselineDaysRemaining, type AcwrResult, type ProgramAgeInput } from '../ai-periodization/acwr'
import { computeActivityScore, strengthWindowEndingAt, type ActivityScoreResult } from './activity-score'
import { getDailyGoals, type DailyGoals, type GoalProfile } from './daily-goals'
import { hrMaxFromAge } from './hr-zones'
import { latestWeightKg } from './latest-weight'
import { intradayHrContributors, type MetGridInput } from './intraday-hr-contributors'
import { excludeLowWearDays, type WearByDate } from './wear-confidence'
import { rowsOfDeviceInUse } from './per-device-normal'
import { dayStepCount } from './activity-steps'

/** Qualifying days before the 28-day resting-HR mean is trusted (the readiness payload's rule). */
const RESTING_HR_BASELINE_MIN_DAYS = 5

/**
 * The 28-day resting-HR baseline, low-wear days excluded: the readiness payload's `baselineRhr`, the
 * reference its resting-HR score and the high/low flag read. It is NOT what the zone lane uses: the
 * lane reads `restingHrOnDay` (`resting-hr-mean.ts`), the one rule the HR zones share (#3388).
 *
 * Per device (#3001): the rows are those of the device that measured the newest night, so an Oura
 * week is never judged against a baseline pooled with the ring's differently measured nights. Until
 * that device has `RESTING_HR_BASELINE_MIN_DAYS` days the baseline is null, not the other device's.
 * #3601: with `versionOn`, per (source, algorithm version) likewise: a source that changes its algorithm
 * restarts the baseline.
 */
export function restingHrBaseline<T extends { date: string; restingHeartRate?: number | null; restingHeartRateSource?: string | null }>(
  bodyMetrics: T[],
  /** #3668: each day's wear in the generic shape (`wearByDate`), never a device's own field. */
  wear: WearByDate,
  /**
   * #3601: a reading's algorithm version (`nightAlgorithmVersion` over the same days' sleep), so the
   * baseline is of the newest reading's (source, version) group. Left out: per source, as before.
   */
  versionOn?: (date: string, source: string | null | undefined) => string | null,
): number | null {
  const onDevice = rowsOfDeviceInUse(
    bodyMetrics, m => m.restingHeartRate, m => m.restingHeartRateSource,
    versionOn ? m => versionOn(m.date, m.restingHeartRateSource) : undefined,
  )
  const rows = excludeLowWearDays(onDevice, wear)
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
  /** `restingHrOnDay(bodyMetrics, date)`: the one resting-HR rule, shared with the HR zones and Body
   *  Battery. Only the zone-minutes lane needs it; null leaves that lane out and the move lane still runs. */
  restingHr: number | null
  /** The day's intraday heart rate, `[local midnight, next local midnight)`. */
  hrRows: readonly { timestamp: Date; bpm: number; source?: string | null }[]
  /** The source's per-minute movement (MET) series covering `date` (`MetGridInput`; the connector maps its own
   *  into it): it decides the move lane (#3114). Null for none. */
  metGrid?: MetGridInput | null
  /** The HR profile's ceiling; null falls back to the age formula. */
  maxHr: number | null
  /** Workout sessions covering at least the 28 days before `date`; later ones are ignored. */
  sessions: readonly { startedAt: string | Date; exercises: { volume?: number | null }[] }[]
  program: ProgramAgeInput | null
  user: { dateOfBirth?: string | null; heightCm?: number | null; sex?: string | null; activityLevel?: GoalProfile['activityLevel'] } | null
  stepsGoal: number | null
  /** The day's logged activities (`date` and `YYYY-MM-DD`); the treadmill ones add their steps to the
   *  device count (`dayStepCount`, #3134). Left out, the day's steps are the device's alone. */
  activityLogs?: readonly { date: string; activityType: string; steps?: number | null }[]
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
  // #3114: the per-minute movement series decides the move lane, so a day with movement and no heart
  // rate still counts. It needs no resting HR (#3388): only the zone-minutes lane waits for one, so a
  // user with no resting-HR baseline yet keeps the move lane. A finished day also drops its non-wear
  // waking hours from the goal (`dayIsOver`).
  const hasMet = input.metGrid?.metsPerMinute.some(m => m != null) ?? false
  if (input.hrRows.length > 0 || hasMet) {
    const c = intradayHrContributors({
      hrRows: input.hrRows,
      maxHr: input.maxHr ?? hrMaxFromAge(ageYears),
      restingHr: input.restingHr,
      tz,
      dateIso: date,
      metGrid: input.metGrid ?? null,
      dayIsOver: date < todayInTz(tz),
    })
    zoneMinutes = c.zoneMinutes
    moveHours = c.moveHours
    moveHoursGoal = c.moveHoursGoal
  }

  const signals = {
    // The same step count every other surface shows (#3134), so a treadmill day scores on it.
    steps: dayStepCount(dayMetrics?.steps, (input.activityLogs ?? []).filter(a => a.date === date)),
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

// The Oura Cloud documents part 2 reads (#2859), and how each one lands in our tables.
//
// Every schema is the pinned spec's model (`.claude/skills/oura-api/references/openapi-v1.34.json`,
// `components.schemas`), cut down to the fields we store. A field is read only under the name the
// spec gives it, and a document that does not match its schema is dropped whole: half a document is
// worse than none, because the per-field merge would keep its gaps as "measured nothing".
//
// The fields #2982 added (series, hypnograms, flags, goals, labels) are the exception, through
// `added`: a value that does not match the spec is stored as nothing rather than dropping a document
// that parsed before they were read. They land in tables no screen reads, so a gap there is a gap,
// never a "measured nothing" on a screen.
//
// Pure: no fetch, no database. `data.ts` fetches, `ingest.ts` writes.
import { z } from 'zod'
import type { OuraDailyRow, OuraSleepUpsertRow } from '@/lib/data/repository'
import type { OuraCloudDailyRow, OuraCloudSleepPeriodRow, OuraSessionRow } from '@/lib/data/postgres/slices/oura'
import type { BodyMetrics } from '@trainingai/shared/types/body'
import { MAX_PLAUSIBLE_BPM, MIN_PLAUSIBLE_BPM } from '@trainingai/shared/validation/plausibility'
import { isCalendarDate } from '@trainingai/shared/date-utils'
import type { OuraScope } from './config'

/** Spec `ISODate`. A real calendar day; stored in the dash form our date columns and keys use. */
const Day = z.string().refine(isCalendarDate, 'not a calendar day').transform(d => d.replace(/\//g, '-'))
/** `LocalizedDateTime` / `UtcDateTime` in the spec: an ISO 8601 instant with its offset. */
const Instant = z.string().min(1).refine(s => !Number.isNaN(Date.parse(s)), 'not an ISO 8601 date-time')
const Int = z.number().int()
const NullableInt = Int.nullable().optional()
const NullableNum = z.number().finite().nullable().optional()
/** A contributors object: every member is `integer | null` in [1, 100] (spec `Public*Contributors`). */
const Contributors = z.record(z.string(), z.number().nullable())

/**
 * A field #2982 added. Absent, `null`, or not the spec's shape all read as `null`: the value is never
 * stored unparsed, and the document it sits in is never dropped for it.
 */
function added<T extends z.ZodType>(schema: T) {
  return schema.nullable().optional().catch(null)
}

/**
 * Spec `PublicSample`: `items` taken every `interval` seconds from `timestamp`. The interval is read
 * from each series, never assumed: the spec states none, and it differs between series.
 */
export const OuraSample = z.object({
  interval: z.number().finite().positive(),
  items: z.array(z.number().finite().nullable()),
  timestamp: Instant,
})
export type OuraSample = z.infer<typeof OuraSample>

/** A per-character class string (`sleep_phase_30_sec`, `movement_30_sec`, `class_5_min`). */
const ClassString = (chars: RegExp) => z.string().regex(chars)

// ── The documents (spec model names in the comments) ──────────────────────────────────────────

/** `PublicDailyReadiness` */
export const DailyReadinessDoc = z.object({
  id: z.string().min(1),
  day: Day,
  score: NullableInt,
  temperature_deviation: NullableNum,
  temperature_trend_deviation: NullableNum,
  contributors: Contributors,
})

/** `PublicDailySleep` */
export const DailySleepDoc = z.object({
  id: z.string().min(1),
  day: Day,
  score: NullableInt,
  contributors: Contributors,
})

/** `PublicDailyActivity`. Every member below is required by the spec except `score`. */
export const DailyActivityDoc = z.object({
  id: z.string().min(1),
  day: Day,
  score: NullableInt,
  active_calories: Int,
  total_calories: Int,
  steps: Int,
  equivalent_walking_distance: Int,
  high_activity_time: Int,
  medium_activity_time: Int,
  low_activity_time: Int,
  sedentary_time: Int,
  resting_time: Int,
  non_wear_time: Int,
  average_met_minutes: z.number().finite(),
  high_activity_met_minutes: Int,
  medium_activity_met_minutes: Int,
  low_activity_met_minutes: Int,
  contributors: Contributors,
  // #2982. Required by the spec, read through `added` (see the top of this file).
  met: added(OuraSample),
  class_5_min: added(ClassString(/^[0-5]*$/)),
  inactivity_alerts: added(Int),
  sedentary_met_minutes: added(Int),
  target_calories: added(Int),
  target_meters: added(Int),
  meters_to_target: added(Int),
})

/** `PublicDailySpO2` */
export const DailySpo2Doc = z.object({
  id: z.string().min(1),
  day: Day,
  breathing_disturbance_index: NullableInt,
  spo2_percentage: z.object({ average: z.number().finite() }).nullable().optional(),
})

/** `PublicDailyStress`. `stress_high` and `recovery_high` are seconds. */
export const DailyStressDoc = z.object({
  id: z.string().min(1),
  day: Day,
  stress_high: NullableInt,
  recovery_high: NullableInt,
  day_summary: z.enum(['restored', 'normal', 'stressful']).nullable().optional(),
})

/** `DailyResilienceModel` */
export const DailyResilienceDoc = z.object({
  id: z.string().min(1),
  day: Day,
  level: z.enum(['limited', 'adequate', 'solid', 'strong', 'exceptional']),
  contributors: z.object({ sleep_recovery: z.number(), daytime_recovery: z.number(), stress: z.number() }),
})

/** `PublicDailyCardiovascularAge` */
export const DailyCardiovascularAgeDoc = z.object({
  id: z.string().min(1),
  day: Day,
  vascular_age: NullableInt,
  pulse_wave_velocity: NullableNum,
})

/** `PublicVO2Max` */
export const Vo2MaxDoc = z.object({
  id: z.string().min(1),
  day: Day,
  vo2_max: z.number().finite(),
})

/** `PublicModifiedSleepModel`. Durations are seconds. */
export const SleepDoc = z.object({
  id: z.string().min(1),
  day: Day,
  bedtime_start: Instant,
  bedtime_end: Instant,
  type: z.enum(['deleted', 'sleep', 'long_sleep', 'late_nap', 'rest']).nullable().optional(),
  time_in_bed: Int,
  total_sleep_duration: NullableInt,
  awake_time: NullableInt,
  light_sleep_duration: NullableInt,
  deep_sleep_duration: NullableInt,
  rem_sleep_duration: NullableInt,
  efficiency: NullableInt,
  latency: NullableInt,
  average_heart_rate: NullableNum,
  lowest_heart_rate: NullableInt,
  average_hrv: NullableInt,
  average_breath: NullableNum,
  restless_periods: NullableInt,
  sleep_phase_5_min: z.string().nullable().optional(),
  // #2982 (`low_battery_alert` and `period` are required by the spec; read through `added` all the same).
  heart_rate: added(OuraSample),
  hrv: added(OuraSample),
  sleep_phase_30_sec: added(ClassString(/^[1-4]*$/)),
  movement_30_sec: added(ClassString(/^[1-4]*$/)),
  sleep_algorithm_version: added(z.enum(['v1', 'v2'])),
  low_battery_alert: added(z.boolean()),
  sleep_analysis_reason: added(z.enum(['foreground_sleep_analysis', 'bedtime_edit'])),
  period: added(Int),
  ring_id: added(z.string().min(1)),
})

/** `PublicWorkout` */
export const WorkoutDoc = z.object({
  id: z.string().min(1),
  day: Day,
  activity: z.string().min(1),
  start_datetime: Instant,
  end_datetime: Instant,
  calories: NullableNum,
  distance: NullableNum,
  intensity: z.enum(['easy', 'moderate', 'hard']),
  source: z.enum(['manual', 'autodetected', 'confirmed', 'workout_heart_rate']),
  label: added(z.string()),
})

/** `PublicSession`: a breathing, meditation, nap … session in the Oura app (#2982). */
export const SessionDoc = z.object({
  id: z.string().min(1),
  day: Day,
  start_datetime: Instant,
  end_datetime: Instant,
  type: z.enum(['breathing', 'meditation', 'nap', 'relaxation', 'rest', 'body_status']),
  mood: added(z.enum(['bad', 'worse', 'same', 'good', 'great'])),
  heart_rate: added(OuraSample),
  heart_rate_variability: added(OuraSample),
  motion_count: added(OuraSample),
})

/**
 * `PublicHeartRateRow`. `source` is Oura's label for the sample, kept as `oura_heartrate.context`
 * (#2982). It is read through `added`: a label Oura adds later must not drop a reading whose
 * timestamp and bpm are fine, which is how a whole heart-rate page could land as nothing.
 */
export const HeartRateRow = z.object({
  timestamp: Instant,
  bpm: z.number().finite(),
  source: added(z.enum(['awake', 'workout', 'rest', 'sleep', 'live', 'session'])),
})

export type DailyReadinessDoc = z.infer<typeof DailyReadinessDoc>
export type DailySleepDoc = z.infer<typeof DailySleepDoc>
export type DailyActivityDoc = z.infer<typeof DailyActivityDoc>
export type DailySpo2Doc = z.infer<typeof DailySpo2Doc>
export type DailyStressDoc = z.infer<typeof DailyStressDoc>
export type DailyResilienceDoc = z.infer<typeof DailyResilienceDoc>
export type DailyCardiovascularAgeDoc = z.infer<typeof DailyCardiovascularAgeDoc>
export type Vo2MaxDoc = z.infer<typeof Vo2MaxDoc>
export type SleepDoc = z.infer<typeof SleepDoc>
export type WorkoutDoc = z.infer<typeof WorkoutDoc>
export type SessionDoc = z.infer<typeof SessionDoc>
export type HeartRateRow = z.infer<typeof HeartRateRow>

/**
 * The document collections we store, keyed by the webhook's `data_type` (spec `ExtApiV2DataType`),
 * with the REST path each one is read from. The two differ once: the webhook says `vo2_max`, the
 * path is `vO2_max`.
 */
export const OURA_DOCUMENT_TYPES = {
  daily_readiness: { path: 'daily_readiness', schema: DailyReadinessDoc },
  daily_sleep: { path: 'daily_sleep', schema: DailySleepDoc },
  daily_activity: { path: 'daily_activity', schema: DailyActivityDoc },
  daily_spo2: { path: 'daily_spo2', schema: DailySpo2Doc },
  daily_stress: { path: 'daily_stress', schema: DailyStressDoc },
  daily_resilience: { path: 'daily_resilience', schema: DailyResilienceDoc },
  daily_cardiovascular_age: { path: 'daily_cardiovascular_age', schema: DailyCardiovascularAgeDoc },
  vo2_max: { path: 'vO2_max', schema: Vo2MaxDoc },
  sleep: { path: 'sleep', schema: SleepDoc },
  workout: { path: 'workout', schema: WorkoutDoc },
  session: { path: 'session', schema: SessionDoc },
} as const

export type OuraDocumentType = keyof typeof OURA_DOCUMENT_TYPES
export const OURA_DOCUMENT_TYPE_NAMES = Object.keys(OURA_DOCUMENT_TYPES) as OuraDocumentType[]

/**
 * The OAuth scope each collection, and the heart-rate series, needs (#2974). Oura answers 401 for a
 * collection whose scope the user did not grant, the same status as a dead token, so the callers
 * check the grant first. The spec maps no route to a scope; these follow its scope descriptions.
 * It names no scope for stress, resilience, cardiovascular age or VO2 max: we assume `daily`, as
 * the oura-api skill does.
 */
export const OURA_SCOPE_FOR: Record<OuraDocumentType | 'heartrate', OuraScope> = {
  daily_readiness: 'daily',
  daily_sleep: 'daily',
  daily_activity: 'daily',
  daily_spo2: 'spo2Daily',
  daily_stress: 'daily',
  daily_resilience: 'daily',
  daily_cardiovascular_age: 'daily',
  vo2_max: 'daily',
  sleep: 'daily',
  workout: 'workout',
  session: 'session',
  heartrate: 'heartrate',
}

/** True when the grant covers `type`. A `null` grant (no scope string stored) covers everything. */
export function isOuraTypeShared(granted: ReadonlySet<string> | null, type: OuraDocumentType | 'heartrate'): boolean {
  return granted === null || granted.has(OURA_SCOPE_FOR[type])
}

export type OuraDocument =
  | { type: 'daily_readiness'; doc: DailyReadinessDoc }
  | { type: 'daily_sleep'; doc: DailySleepDoc }
  | { type: 'daily_activity'; doc: DailyActivityDoc }
  | { type: 'daily_spo2'; doc: DailySpo2Doc }
  | { type: 'daily_stress'; doc: DailyStressDoc }
  | { type: 'daily_resilience'; doc: DailyResilienceDoc }
  | { type: 'daily_cardiovascular_age'; doc: DailyCardiovascularAgeDoc }
  | { type: 'vo2_max'; doc: Vo2MaxDoc }
  | { type: 'sleep'; doc: SleepDoc }
  | { type: 'workout'; doc: WorkoutDoc }
  | { type: 'session'; doc: SessionDoc }

/** Parses one document of `type`; `null` when it does not match the spec's shape. */
export function parseOuraDocument(type: OuraDocumentType, raw: unknown): OuraDocument | null {
  const parsed = OURA_DOCUMENT_TYPES[type].schema.safeParse(raw)
  return parsed.success ? ({ type, doc: parsed.data } as OuraDocument) : null
}

// ── Mapping to our rows ───────────────────────────────────────────────────────────────────────

export type OuraBodyMetricsRow = Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>

export interface OuraWorkoutRow {
  id: string
  day: string
  activity: string
  startDatetime: Date
  endDatetime: Date
  calories: number | null
  distanceM: number | null
  intensity: string
  source: string
  label: string | null
}

/** Everything one batch of documents writes, already merged so each conflict key appears once. */
export interface OuraCloudWrites {
  daily: OuraDailyRow[]
  body: OuraBodyMetricsRow[]
  sleep: OuraSleepUpsertRow[]
  /** Oura ids of sleep periods Oura now reports as `deleted`. */
  deletedSleepIds: string[]
  workouts: OuraWorkoutRow[]
  /** #2982: every sleep period as Oura sent it, `rest` and `deleted` included. */
  sleepPeriods: OuraCloudSleepPeriodRow[]
  /** #2982: per day, only the fields a document provided; merged so each day appears once. */
  cloudDaily: OuraCloudDailyRow[]
  sessions: OuraSessionRow[]
}

/** Sleep types that are sleep. `rest` is a rest period and `deleted` is a removed one. */
const SLEEP_TYPES = new Set(['sleep', 'long_sleep', 'late_nap'])

const hours = (sec: number | null | undefined) => (sec == null ? null : sec / 3600)

/**
 * **Oura's readiness, sleep and activity contributors and the stress `day_summary` go to
 * `oura_cloud_daily` (#2982), never to `oura_daily`.** Stored in `oura_daily`, they would win over
 * our own on the Sleep and Activity screens: `readiness-payload.ts` prefers Oura's contributors when
 * present, the device's local store syncs the same columns and reads them directly, and the
 * Readiness screen and the AI planner read `day_summary`. That is a visible change to a scoring
 * surface, which needs the owner's yes; choosing per field between Oura's and ours is #2860's job.
 *
 * Turns documents into rows. Several documents for one day (readiness, sleep score, activity …)
 * become one `oura_daily` row and one `body_metrics` row, because the upsert cannot touch a row twice
 * in one statement. Only fields the spec provides are set; everything else stays absent so the
 * per-field merge leaves the stored value alone.
 */
export function mapOuraDocuments(docs: readonly OuraDocument[]): OuraCloudWrites {
  const daily = new Map<string, OuraDailyRow>()
  const body = new Map<string, OuraBodyMetricsRow>()
  const sleep = new Map<string, OuraSleepUpsertRow>()
  const deletedSleepIds: string[] = []
  const workouts = new Map<string, OuraWorkoutRow>()
  const sleepPeriods = new Map<string, OuraCloudSleepPeriodRow>()
  const cloudDaily = new Map<string, OuraCloudDailyRow>()
  const sessions = new Map<string, OuraSessionRow>()

  const cloudDay = (d: string) => {
    let row = cloudDaily.get(d)
    if (!row) { row = { date: d }; cloudDaily.set(d, row) }
    return row
  }
  const day = (d: string) => {
    let row = daily.get(d)
    if (!row) { row = { date: d }; daily.set(d, row) }
    return row
  }
  const bodyDay = (d: string) => {
    let row = body.get(d)
    if (!row) { row = { date: d }; body.set(d, row) }
    return row
  }
  // Main-sleep vitals per day: the longest `long_sleep` wins, so a nap never stands for the night.
  const mainSleepSec = new Map<string, number>()

  for (const { type, doc } of docs) {
    switch (type) {
      case 'daily_readiness': {
        Object.assign(day(doc.day), {
          readinessScore: doc.score ?? null,
          temperatureDeviation: doc.temperature_deviation ?? null,
          temperatureTrendDeviation: doc.temperature_trend_deviation ?? null,
        })
        cloudDay(doc.day).readinessContributors = doc.contributors
        break
      }
      case 'daily_sleep':
        day(doc.day).sleepScore = doc.score ?? null
        cloudDay(doc.day).sleepContributors = doc.contributors
        break
      case 'daily_activity':
        Object.assign(day(doc.day), {
          activityScore: doc.score ?? null,
          activeCalories: doc.active_calories,
          totalCalories: doc.total_calories,
          equivalentWalkingDistance: doc.equivalent_walking_distance,
          highActivityTimeSec: doc.high_activity_time,
          mediumActivityTimeSec: doc.medium_activity_time,
          lowActivityTimeSec: doc.low_activity_time,
          sedentaryTimeSec: doc.sedentary_time,
          restingTimeSec: doc.resting_time,
          nonWearTimeSec: doc.non_wear_time,
          avgMetMinutes: doc.average_met_minutes,
          highActivityMetMinutes: doc.high_activity_met_minutes,
          mediumActivityMetMinutes: doc.medium_activity_met_minutes,
          lowActivityMetMinutes: doc.low_activity_met_minutes,
        })
        Object.assign(bodyDay(doc.day), { steps: doc.steps, activeCalories: doc.active_calories })
        Object.assign(cloudDay(doc.day), {
          activityContributors: doc.contributors,
          met: doc.met ?? null,
          class5Min: doc.class_5_min ?? null,
          inactivityAlerts: doc.inactivity_alerts ?? null,
          sedentaryMetMinutes: doc.sedentary_met_minutes ?? null,
          targetCalories: doc.target_calories ?? null,
          targetMeters: doc.target_meters ?? null,
          metersToTarget: doc.meters_to_target ?? null,
        })
        break
      case 'daily_spo2':
        day(doc.day).breathingDisturbanceIndex = doc.breathing_disturbance_index ?? null
        if (doc.spo2_percentage?.average != null) bodyDay(doc.day).spo2Pct = doc.spo2_percentage.average
        break
      case 'daily_stress':
        Object.assign(day(doc.day), {
          stressHigh: doc.stress_high ?? null,
          recoveryHigh: doc.recovery_high ?? null,
        })
        cloudDay(doc.day).daySummary = doc.day_summary ?? null
        break
      case 'daily_resilience':
        Object.assign(day(doc.day), { resilienceLevel: doc.level, resilienceContributors: doc.contributors })
        break
      case 'daily_cardiovascular_age':
        Object.assign(day(doc.day), { vascularAge: doc.vascular_age ?? null, pulseWaveVelocity: doc.pulse_wave_velocity ?? null })
        break
      case 'vo2_max':
        day(doc.day).vo2Max = doc.vo2_max
        break
      case 'sleep': {
        sleepPeriods.set(doc.id, {
          ouraId: doc.id,
          day: doc.day,
          bedtimeStart: new Date(doc.bedtime_start),
          bedtimeEnd: new Date(doc.bedtime_end),
          sleepType: doc.type ?? null,
          heartRate: doc.heart_rate ?? null,
          hrv: doc.hrv ?? null,
          sleepPhase30Sec: doc.sleep_phase_30_sec ?? null,
          movement30Sec: doc.movement_30_sec ?? null,
          sleepAlgorithmVersion: doc.sleep_algorithm_version ?? null,
          lowBatteryAlert: doc.low_battery_alert ?? null,
          sleepAnalysisReason: doc.sleep_analysis_reason ?? null,
          period: doc.period ?? null,
          ringId: doc.ring_id ?? null,
        })
        if (doc.type === 'deleted') { deletedSleepIds.push(doc.id); break }
        if (doc.type != null && !SLEEP_TYPES.has(doc.type)) break
        const start = new Date(doc.bedtime_start)
        const end = new Date(doc.bedtime_end)
        if (!(end.getTime() > start.getTime())) break
        sleep.set(doc.id, {
          ouraId: doc.id,
          date: doc.day,
          sleepStart: start,
          sleepEnd: end,
          durationHours: hours(doc.total_sleep_duration),
          deepSleepHours: hours(doc.deep_sleep_duration),
          remSleepHours: hours(doc.rem_sleep_duration),
          lightSleepHours: hours(doc.light_sleep_duration),
          awakHours: hours(doc.awake_time),
          timeInBedHours: hours(doc.time_in_bed),
          efficiency: doc.efficiency ?? null,
          onsetLatencySec: doc.latency ?? null,
          averageHrvMs: doc.average_hrv ?? null,
          avgHeartRate: doc.average_heart_rate ?? null,
          lowestHeartRate: doc.lowest_heart_rate ?? null,
          restlessPeriods: doc.restless_periods ?? null,
          respiratoryRate: doc.average_breath ?? null,
          sleepPhase5Min: doc.sleep_phase_5_min ?? null,
        })
        if (doc.type === 'long_sleep' && (doc.total_sleep_duration ?? 0) > (mainSleepSec.get(doc.day) ?? -1)) {
          mainSleepSec.set(doc.day, doc.total_sleep_duration ?? 0)
          const b = bodyDay(doc.day)
          b.hrvMs = doc.average_hrv ?? undefined
          b.restingHeartRate = doc.lowest_heart_rate ?? undefined
        }
        break
      }
      case 'workout': {
        const start = new Date(doc.start_datetime)
        const end = new Date(doc.end_datetime)
        if (!(end.getTime() >= start.getTime())) break
        workouts.set(doc.id, {
          id: doc.id, day: doc.day, activity: doc.activity, startDatetime: start, endDatetime: end,
          calories: doc.calories ?? null, distanceM: doc.distance ?? null, intensity: doc.intensity, source: doc.source,
          label: doc.label ?? null,
        })
        break
      }
      case 'session': {
        const start = new Date(doc.start_datetime)
        const end = new Date(doc.end_datetime)
        if (!(end.getTime() >= start.getTime())) break
        sessions.set(doc.id, {
          ouraId: doc.id, day: doc.day, sessionType: doc.type, startDatetime: start, endDatetime: end,
          mood: doc.mood ?? null,
          heartRate: doc.heart_rate ?? null,
          heartRateVariability: doc.heart_rate_variability ?? null,
          motionCount: doc.motion_count ?? null,
        })
        break
      }
    }
  }

  return {
    daily: [...daily.values()],
    // A body row with nothing but its date would only re-stamp `synced_at`; leave it out.
    body: [...body.values()].filter(r => Object.entries(r).some(([k, v]) => k !== 'date' && v != null)),
    sleep: [...sleep.values()],
    deletedSleepIds,
    workouts: [...workouts.values()],
    sleepPeriods: [...sleepPeriods.values()],
    cloudDaily: [...cloudDaily.values()],
    sessions: [...sessions.values()],
  }
}

export interface OuraHeartRatePoint { timestamp: Date; bpm: number; context: string | null }

/**
 * Heart-rate rows as `oura_heartrate` points. Oura's `source` (awake, sleep …) is its label, not our
 * provenance, so it becomes the point's `context` (#2982); the row's `source` stays `oura_cloud`. A
 * bpm outside the plausible band is a fault, not a reading, so it is dropped (never clamped).
 */
export function mapHeartRateRows(rows: readonly HeartRateRow[]): OuraHeartRatePoint[] {
  const out: OuraHeartRatePoint[] = []
  for (const r of rows) {
    const bpm = Math.round(r.bpm)
    if (bpm >= MIN_PLAUSIBLE_BPM && bpm <= MAX_PLAUSIBLE_BPM) out.push({ timestamp: new Date(r.timestamp), bpm, context: r.source ?? null })
  }
  return out
}

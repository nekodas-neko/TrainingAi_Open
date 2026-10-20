// The Oura Cloud documents part 2 reads (#2859), and how each one lands in our tables.
//
// Every schema is the pinned spec's model (`.claude/skills/oura-api/references/openapi-v1.42.json`,
// `components.schemas`), cut down to the fields we store. A field is read only under the name the
// spec gives it, and a document that does not match its schema is dropped whole: half a document is
// worse than none, because the per-field merge would keep its gaps as "measured nothing".
//
// The fields #2982 added (series, hypnograms, flags, goals, labels) are the exception, through
// `added`: a value that does not match the spec is stored as nothing rather than dropping a document
// that parsed before they were read. A gap there is a gap, never a "measured nothing" on a screen.
//
// **Enum fields are the other exception (#3081, as #3033 was for `workout.source`).** Oura adds
// values without a version bump in practice, and a value outside the list used to drop the whole
// document: a night with a new `type` would vanish. Every enum field is read as a string and checked
// against `OURA_ENUMS` in `mapOuraDocuments`. A value on the list is kept; one that is not is stored
// as null (except `sleep.type`, kept raw, below), counted in `unknownValues`, and reported by the
// ingest with counts only. The document lands either way.
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

/**
 * The spec's values for every enum field we read (v1.42, `components.schemas`), keyed `type.field`.
 * Read leniently: see the top of this file. Adding a value Oura documents is a line here.
 */
export const OURA_ENUMS = {
  'sleep.type': ['deleted', 'sleep', 'long_sleep', 'late_nap', 'rest'],
  'sleep.sleep_analysis_reason': ['foreground_sleep_analysis', 'bedtime_edit', 'background_sleep_analysis', 'background_created_foreground_updated'],
  'sleep.sleep_algorithm_version': ['v1', 'v2'],
  'daily_stress.day_summary': ['restored', 'normal', 'stressful'],
  'daily_resilience.level': ['limited', 'adequate', 'solid', 'strong', 'exceptional'],
  'workout.intensity': ['easy', 'moderate', 'hard'],
  'workout.source': ['manual', 'autodetected', 'confirmed', 'workout_heart_rate', 'live_third_party_heart_rate', 'live_oura_heart_rate'],
  'session.type': ['breathing', 'meditation', 'nap', 'relaxation', 'rest', 'body_status'],
  'session.mood': ['bad', 'worse', 'same', 'good', 'great'],
} as const satisfies Record<string, readonly string[]>
export type OuraEnumField = keyof typeof OURA_ENUMS

/**
 * An enum field as Oura sent it: any short string. A value outside the spec's list is decided in the
 * mapping, never here, so it cannot cost the document. A non-string is not a new value; for a field
 * the spec requires it still fails the document, as any wrong shape does.
 */
const Label = z.string().min(1).max(64)
const OptionalLabel = Label.nullable().optional()
/** For an optional enum field #2982 added: a wrong shape reads as null, as `added` does. */
const AddedLabel = Label.nullable().optional().catch(null)

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
  day_summary: OptionalLabel,
})

/** `DailyResilienceModel` */
export const DailyResilienceDoc = z.object({
  id: z.string().min(1),
  day: Day,
  level: Label,
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
  type: OptionalLabel,
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
  sleep_algorithm_version: AddedLabel,
  low_battery_alert: added(z.boolean()),
  sleep_analysis_reason: AddedLabel,
  period: added(Int),
  ring_id: added(z.string().min(1)),
})

/**
 * `PublicWorkout`. `source` is a label, so it never costs us the workout: v1.42 added two values
 * (#3033) that dropped every live-heart-rate workout whole while we read only v1.34's four. A value
 * outside the spec's list, or none, stores as `null` ("not stated") and the workout lands. #3081:
 * `intensity` the same way.
 */
export const WorkoutDoc = z.object({
  id: z.string().min(1),
  day: Day,
  activity: z.string().min(1),
  start_datetime: Instant,
  end_datetime: Instant,
  calories: NullableNum,
  distance: NullableNum,
  intensity: Label,
  source: AddedLabel,
  label: added(z.string()),
})

/** `PublicSession`: a breathing, meditation, nap … session in the Oura app (#2982). */
export const SessionDoc = z.object({
  id: z.string().min(1),
  day: Day,
  start_datetime: Instant,
  end_datetime: Instant,
  type: Label,
  mood: AddedLabel,
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
 * The types whose `delete` event the webhook acts on, and so subscribes to (`subscriptions.ts`). A
 * sleep period (#2859) and a workout (#3087, `oura_workouts.deleted_at`) are tombstoned. A delete is a
 * tombstone, never a removal: deleting data is the owner's call (#3155 review). Not yet:
 *   - `session`: needs an `oura_sessions.deleted_at` tombstone first, a migration of its own (#3153);
 *   - the daily documents: a delete names only the document's id, which we do not store, so it cannot
 *     be traced to a day yet (#3153).
 */
export const OURA_DELETE_TYPES: readonly OuraDocumentType[] = ['sleep', 'workout']

/**
 * The OAuth scope each collection, and the heart-rate series, needs (#2974). Oura answers 401 for a
 * collection whose scope the user did not grant, the same status as a dead token, so the callers
 * check the grant first. The spec (v1.42) maps no route to a scope; these follow its scope
 * descriptions and what Oura refused (#3026). It names no scope for stress; `daily` has been
 * accepted for it.
 */
export const OURA_SCOPE_FOR: Record<OuraDocumentType | 'heartrate', OuraScope> = {
  daily_readiness: 'daily',
  daily_sleep: 'daily',
  daily_activity: 'daily',
  daily_spo2: 'spo2',
  daily_stress: 'daily',
  // A guess. The spec names no scope for resilience; Oura refused it under `daily` while it took
  // stress, and `heart_health` is the only scope left that could cover it (#3026).
  daily_resilience: 'heart_health',
  daily_cardiovascular_age: 'heart_health',
  vo2_max: 'heart_health',
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
  intensity: string | null
  source: string | null
  label: string | null
}

/** Everything one batch of documents writes, already merged so each conflict key appears once. */
export interface OuraCloudWrites {
  daily: OuraDailyRow[]
  body: OuraBodyMetricsRow[]
  sleep: OuraSleepUpsertRow[]
  /** Oura ids of sleep periods Oura now reports as `deleted`. */
  deletedSleepIds: string[]
  /**
   * #3080: Oura ids of periods Oura now types as something that is not sleep (`rest`: the user
   * rejected it in the Oura app). Their night is tombstoned like a delete, but the period row keeps
   * Oura's own type.
   */
  retypedSleepIds: string[]
  workouts: OuraWorkoutRow[]
  /** #2982: every sleep period as Oura sent it, `rest` and `deleted` included. */
  sleepPeriods: OuraCloudSleepPeriodRow[]
  /** #2982: per day, only the fields a document provided; merged so each day appears once. */
  cloudDaily: OuraCloudDailyRow[]
  sessions: OuraSessionRow[]
  /**
   * #3081: how many values outside `OURA_ENUMS` each field carried in this batch. The documents were
   * kept; the ingest reports the counts. Absent or empty when every value was on the list.
   */
  unknownValues?: Partial<Record<OuraEnumField, number>>
}

const hours = (sec: number | null | undefined) => (sec == null ? null : sec / 3600)

/**
 * **Oura's readiness, sleep and activity contributors and the stress `day_summary` go to
 * `oura_cloud_daily` (#2982), never to `oura_daily`.** They are Oura's, kept as a reference. The
 * device's local store syncs `oura_daily`'s contributor columns, so keeping them there keeps Oura's
 * contributors off the device. Oura's top-level readiness, sleep and activity scores do land in
 * `oura_daily`, as Oura's own scores: no screen or AI surface shows or sends them as ours (scoring
 * doc rule 5, #3000). They are the tuning reference (#2986).
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
  const retypedSleepIds: string[] = []
  const workouts = new Map<string, OuraWorkoutRow>()
  const sleepPeriods = new Map<string, OuraCloudSleepPeriodRow>()
  const cloudDaily = new Map<string, OuraCloudDailyRow>()
  const sessions = new Map<string, OuraSessionRow>()
  const unknownValues: Partial<Record<OuraEnumField, number>> = {}
  /** `value` when the spec lists it, else null and counted. Null stays null, uncounted. */
  const known = (field: OuraEnumField, value: string | null | undefined): string | null => {
    if (value == null) return null
    if ((OURA_ENUMS[field] as readonly string[]).includes(value)) return value
    unknownValues[field] = (unknownValues[field] ?? 0) + 1
    return null
  }

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
        cloudDay(doc.day).daySummary = known('daily_stress.day_summary', doc.day_summary)
        break
      case 'daily_resilience':
        Object.assign(day(doc.day), { resilienceLevel: known('daily_resilience.level', doc.level), resilienceContributors: doc.contributors })
        break
      case 'daily_cardiovascular_age':
        Object.assign(day(doc.day), { vascularAge: doc.vascular_age ?? null, pulseWaveVelocity: doc.pulse_wave_velocity ?? null })
        break
      case 'vo2_max':
        day(doc.day).vo2Max = doc.vo2_max
        break
      case 'sleep': {
        // #3081: a type Oura adds is stored as sent, so it is never lost, and it is written as a
        // period like `sleep`. It cannot become the night: only `long_sleep` is a main period, so
        // beside one it is secondary (`ouraSecondaryPeriods`), and on its own it is an ordinary
        // period, exactly as an untyped one is. Only `deleted` and `rest` remove a period.
        known('sleep.type', doc.type) // counts a type off the list; the raw value is what is stored
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
          sleepAlgorithmVersion: known('sleep.sleep_algorithm_version', doc.sleep_algorithm_version),
          lowBatteryAlert: doc.low_battery_alert ?? null,
          sleepAnalysisReason: known('sleep.sleep_analysis_reason', doc.sleep_analysis_reason),
          period: doc.period ?? null,
          ringId: doc.ring_id ?? null,
        })
        if (doc.type === 'deleted') { deletedSleepIds.push(doc.id); break }
        if (doc.type === 'rest') { retypedSleepIds.push(doc.id); break }
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
        // #3080: the day's HRV and resting HR are no longer taken here. One document is one period,
        // and on the webhook path the last event won, not the longest period; they are set from the
        // day's main period among every stored one, after the write (`syncOuraMainSleepBodyMetrics`).
        break
      }
      case 'workout': {
        const start = new Date(doc.start_datetime)
        const end = new Date(doc.end_datetime)
        if (!(end.getTime() >= start.getTime())) break
        workouts.set(doc.id, {
          id: doc.id, day: doc.day, activity: doc.activity, startDatetime: start, endDatetime: end,
          calories: doc.calories ?? null, distanceM: doc.distance ?? null,
          intensity: known('workout.intensity', doc.intensity), source: known('workout.source', doc.source),
          label: doc.label ?? null,
        })
        break
      }
      case 'session': {
        const start = new Date(doc.start_datetime)
        const end = new Date(doc.end_datetime)
        if (!(end.getTime() >= start.getTime())) break
        sessions.set(doc.id, {
          ouraId: doc.id, day: doc.day, sessionType: known('session.type', doc.type), startDatetime: start, endDatetime: end,
          mood: known('session.mood', doc.mood),
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
    retypedSleepIds,
    workouts: [...workouts.values()],
    sleepPeriods: [...sleepPeriods.values()],
    cloudDaily: [...cloudDaily.values()],
    sessions: [...sessions.values()],
    unknownValues,
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

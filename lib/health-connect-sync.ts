// Runs only in the Capacitor native container. In the browser this module is
// imported but syncHealthConnect() exits immediately after the platform check.
//
// All data is read via @devmaxime/capacitor-health-connect, which is patched
// (patches/@devmaxime__capacitor-health-connect.patch) to add BodyFat and
// Nutrition record types and their JSON converters.

import type { HealthConnectPlugin } from '@devmaxime/capacitor-health-connect';
import { intervalsToPhase5Min, type SleepStage, type StageInterval } from '@trainingai/shared/health/hypnogram';
import { msToHHMMInTz, toAestDay, shiftDateStr, dateStrMidnightInTz, daysBetweenDateStrs, isCalendarDate, todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { capitalize } from '@trainingai/shared/format/capitalize';
import { FirstHandFilter, knownFirstHandSources, type FirstHandSources } from '@trainingai/shared/health/health-connect-origin';

// Verified against the pinned plugin source (RecordConverter.kt:390-400, v1.1.0) — those seven
// strings are the complete set it can emit. SLEEPING and UNKNOWN are deliberately absent: they
// mean "asleep, stage not determined", which the 4-code sleep_phase_5_min encoding cannot express
// without inventing a stage. Health Connect's AWAKE_IN_BED (7) has no branch in that `when`, so it
// arrives as SLEEP_STAGE_UNKNOWN and is likewise unstaged.
const HC_STAGE_TO_SLEEP_STAGE: Record<string, SleepStage> = {
  SLEEP_STAGE_DEEP:        'deep',
  SLEEP_STAGE_LIGHT:       'light',
  SLEEP_STAGE_REM:         'rem',
  SLEEP_STAGE_AWAKE:       'awake',
  SLEEP_STAGE_OUT_OF_BED:  'awake',
};

export const LAST_SYNC_KEY  = 'ta_hc_last_sync';
export const SYNC_DAYS_COLD = 30;  // days on first install
const SYNC_DAYS_HOT  = 7;   // days on subsequent opens

// Canonical read-type lists. Both requestPermissions and canRead.has() checks
// must draw from these — any drift is caught by the parity test.
//
// #2462 added `ActiveCaloriesBurned` (READ_ACTIVE_CALORIES_BURNED — declared in the manifest since
// before this, but never requested, so it is a NEW runtime grant). Step cadence is deliberately NOT
// listed: `StepsCadenceSeries` reads under READ_STEPS (connect-client 1.1.0-alpha11's
// `HealthPermission` maps `StepsCadenceRecord` to it), and the plugin's `reversePermission` returns
// the first record name for a permission, which is `Steps` — so `StepsCadenceSeries` could never
// appear in the granted list. Cadence is read when `Steps` is granted.
export const HC_SYNC_READ_TYPES = [
  'Steps', 'Weight', 'ActivitySession', 'SleepSession', 'BodyFat',
  'Nutrition', 'RestingHeartRate', 'OxygenSaturation', 'HeartRateSeries',
  'TotalCaloriesBurned', 'HeartRateVariabilityRmssd', 'ActiveCaloriesBurned',
] as const;

export const HC_ENRICH_READ_TYPES = ['Steps', 'HeartRateSeries'] as const;

interface DailyMetric {
  date: string;
  steps?: number;
  distanceKm?: number;
  caloriesBurned?: number;  // total calories burned (activity)
  weightKg?: number;
  bodyFatPct?: number;
  calories?: number;        // dietary calories from nutrition log
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  restingHeartRate?: number; // overnight min BPM (midnight–8am)
  hrvMs?: number;            // mean overnight RMSSD HRV in ms — the read is `HeartRateVariabilityRmssd`
                             // (TN-44: the comment said SDNN; this repo has shipped that mix-up once)
  spo2Pct?: number;          // mean overnight SpO2 %
}

interface ExerciseSession {
  date: string;
  title: string;
  activityType: string;
  startTime: string;  // HH:MM
  endTime: string;
  durationMin: number;
  distanceKm?: number;
  caloriesBurned?: number;
  avgHr?: number;
  maxHr?: number;
  /** #3044. `metadata.id`, which the server keys the session on, and `metadata.dataOrigin`. */
  recordId?: string;
  origin?: string;
}

// Map Health Connect's exerciseType string constants to our activity_types slugs.
// Manually-added/admin activity types are not part of this mapping — anything
// HC reports that we don't recognize falls back to 'other'.
const EXERCISE_TYPE_TO_ACTIVITY_TYPE: Record<string, string> = {
  EXERCISE_TYPE_WALKING: 'walk',
  EXERCISE_TYPE_RUNNING: 'run',
  EXERCISE_TYPE_RUNNING_TREADMILL: 'run',
  EXERCISE_TYPE_BIKING: 'cycle',
  EXERCISE_TYPE_BIKING_STATIONARY: 'cycle',
  EXERCISE_TYPE_HIKING: 'hike',
  EXERCISE_TYPE_SWIMMING_POOL: 'swim',
  EXERCISE_TYPE_SWIMMING_OPEN_WATER: 'swim',
  EXERCISE_TYPE_YOGA: 'yoga',
  EXERCISE_TYPE_STRETCHING: 'stretch',
  EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING: 'hiit',
  // #2828 N6. A watch's gym session, which as 'other' was costed at the generic 6.0 MET cardio rate
  // rather than strength training's (`strength` in `activity_types`, #3160).
  EXERCISE_TYPE_STRENGTH_TRAINING: 'strength',
  EXERCISE_TYPE_WEIGHTLIFTING: 'strength',
  EXERCISE_TYPE_CALISTHENICS: 'strength',
};

export function mapExerciseTypeToActivityType(exerciseType: string): string {
  return EXERCISE_TYPE_TO_ACTIVITY_TYPE[exerciseType] ?? 'other';
}

/**
 * #2828 N5. What an untitled session is called: the plugin's exercise-type constant in words, so
 * `EXERCISE_TYPE_STRENGTH_TRAINING` reads "Strength training". The constants are the pinned
 * converter's (`RecordConverter.kt`, `convertExerciseType`), whose fallbacks are
 * `EXERCISE_TYPE_OTHER_WORKOUT` and `UNKNOWN_EXERCISE_TYPE`; both read "Workout".
 */
export function exerciseTypeLabel(exerciseType: string | undefined): string {
  const words = (exerciseType ?? '').replace(/^EXERCISE_TYPE_/, '').toLowerCase().replace(/_/g, ' ').trim();
  if (!words || words === 'other workout' || words === 'unknown exercise type') return 'Workout';
  return capitalize(words);
}

interface SleepRecord {
  date: string;           // wake-up date YYYY-MM-DD
  sleepStart: string;     // ISO timestamp
  sleepEnd: string;
  durationHours: number;
  deepSleepHours?: number;
  remSleepHours?: number;
  lightSleepHours?: number;
  awakHours?: number;
  /** 5-min stage codes ('1'=deep '2'=light '3'=REM '4'=awake), same encoding the ring writes.
   *  Omitted when the provider staged only part of the night — see intervalsToPhase5Min. */
  sleepPhase5Min?: string;
}

export interface SyncPayload {
  dailyMetrics: DailyMetric[];
  exerciseSessions: ExerciseSession[];
  sleepRecords: SleepRecord[];
  heartRateSamples?: HeartRateSample[];
  /** issue 2169: set only by the explicit "Import more history" run, to the first local day of the
   *  window being imported. It tells `/api/sync-health` that heart-rate and interval rows this old
   *  are deliberate, not a broken clock. Absent on every ordinary sync. */
  historyFrom?: string;
  /** #3044: the local days whose exercise sessions were read in full, sent only when that read
   *  succeeded. A stored Health Connect session dated inside it whose id is in neither
   *  `exerciseSessions` nor `leftOut` was deleted there. `leftOut` holds the ids of sessions the
   *  phone read and did not send (#3115), so they are not mistaken for deletions. */
  exerciseWindow?: { from: string; to: string; leftOut?: string[] };
}

/** One intraday heart-rate reading, at the source's own resolution. `at` is epoch ms. */
export interface HeartRateSample { at: number; bpm: number }

/** One request's share of the heart-rate series. `/api/sync-health` imports it as its own cap. */
export const HR_UPLOAD_CHUNK = 10_000
/** Heart-rate requests per sync. The route allows 60 a minute, so a dense 30-day cold sync is
 *  bounded rather than run into a 429 halfway; newest samples go first, so a cap drops the oldest. */
export const HR_UPLOAD_MAX_CHUNKS = 20

/**
 * The samples inside the plugin's `HeartRateSeries` records, newest first (#2168).
 *
 * Field names are the patched converter's (`patches/@devmaxime__capacitor-health-connect.patch`,
 * LA-115): each record carries `samples[]` of `{ time, beatsPerMinute }`, from `HeartRateRecord
 * .Sample`'s `getTime(): Instant` and `getBeatsPerMinute(): long` in the pinned connect-client
 * 1.1.0-alpha11. Before LA-115 the record came back as a `toString()` blob, which is why anything
 * that does not have this shape is skipped rather than trusted — and a sample whose time does not
 * parse or whose bpm is not a finite number is dropped here, never sent as NaN.
 */
export function flattenHeartRateRecords(records: unknown[]): HeartRateSample[] {
  const out: HeartRateSample[] = []
  for (const r of records) {
    const samples = (r as { samples?: unknown } | null)?.samples
    if (!Array.isArray(samples)) continue
    for (const s of samples as Array<{ time?: unknown; beatsPerMinute?: unknown }>) {
      const at = typeof s?.time === 'string' ? Date.parse(s.time) : NaN
      const bpm = s?.beatsPerMinute
      if (!Number.isFinite(at) || typeof bpm !== 'number' || !Number.isFinite(bpm)) continue
      out.push({ at, bpm })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Split an already newest-first list into request-sized chunks, keeping at most `maxChunks`. */
function chunkNewestFirst<T>(items: readonly T[], size: number, maxChunks: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length && chunks.length < maxChunks; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Split samples into request-sized chunks, keeping at most `maxChunks` of them. */
export function chunkHeartRateSamples(
  samples: HeartRateSample[], size: number = HR_UPLOAD_CHUNK, maxChunks: number = HR_UPLOAD_MAX_CHUNKS,
): HeartRateSample[][] {
  return chunkNewestFirst(samples, size, maxChunks)
}

/** Post a newest-first series to `/api/sync-health` under `field`, in chunks; stops at the first
 *  failure. The window is re-read on every sync, so anything not sent this time goes next time while
 *  it is still inside the window. `label` and `unit` word the note. */
async function uploadSeries<T>(
  field: 'heartRateSamples' | 'activityIntervals', items: readonly T[], size: number, maxChunks: number,
  label: string, unit: string, historyFrom?: string,
): Promise<{ sent: number; requests: number; failed?: true; note?: string }> {
  let sent = 0
  let requests = 0
  for (const chunk of chunkNewestFirst(items, size, maxChunks)) {
    requests += 1
    try {
      const res = await fetch('/api/sync-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: chunk, ...(historyFrom ? { historyFrom } : {}) }),
      })
      if (!res.ok) return { sent, requests, failed: true, note: `${label} stopped at sync-health ${res.status}` }
    } catch (err) {
      return { sent, requests, failed: true, note: `${label} stopped: ${err instanceof Error ? err.message : String(err)}` }
    }
    sent += chunk.length
  }
  const left = items.length - sent
  return left > 0 ? { sent, requests, note: `${label}: ${left} older ${unit} over the per-sync cap` } : { sent, requests }
}

// ── Per-interval movement (#2462) ────────────────────────────────────────────

/** What `health_connect_intervals.kind` holds: a step count or active kcal over [startMs, endMs],
 *  or a cadence sample in steps/min at startMs (= endMs). */
export type ActivityIntervalKind = 'steps' | 'active_kcal' | 'cadence_spm'

/** One row for `/api/sync-health`'s `activityIntervals`. `recordId` is Health Connect's own record
 *  id (`metadata.id`), which the server keys on so a re-read window is idempotent. */
export interface ActivityInterval {
  kind: ActivityIntervalKind
  startMs: number
  endMs: number
  value: number
  recordId: string
  /** The writing app's package (`metadata.dataOrigin`). */
  origin?: string
  /** `metadata.device.type` as the plugin spells it, e.g. TYPE_WATCH. */
  device?: string
}

/** One request's share of the interval rows. ~170 bytes a row as JSON, so a chunk is ~700 KB, under
 *  the route's 1 MB body cap. `/api/sync-health` imports it as its own array cap. */
export const INTERVAL_UPLOAD_CHUNK = 4_000
/** Interval requests per sync. With the heart-rate cap (20) and the daily post this stays under the
 *  route's 60 a minute; newest rows go first, so a cap drops the oldest. */
export const INTERVAL_UPLOAD_MAX_CHUNKS = 20

type HcSleepRecord = {
  startTime: string; endTime: string;
  stages?: Array<{ startTime: string; endTime: string; stage: string }>;
  metadata?: { dataOrigin?: unknown } | null;
};
/**
 * #3115: keeps one app's sleep records per night, the way the native app's `sleep-samples.ts` picks
 * one source per moment. Records that overlap, directly or through a chain, form one night; in each,
 * the app with the most staged sleep keeps its records (a session with no stages counts none), ties
 * going to the earlier package name so the choice is stable. Records of other nights are untouched.
 */
export function oneAppPerNight<T extends HcSleepRecord>(records: readonly T[]): T[] {
  const span = (r: { startTime: string; endTime: string }) => Date.parse(r.endTime) - Date.parse(r.startTime);
  // Staged time only, as `sleep-samples.ts` counts it: a session with no stages has none, so an app
  // that writes only a bedtime span never outranks one that measured the night (#3154 review).
  const staged = (r: T) => (r.stages ?? []).reduce((sum, stage) => sum + Math.max(0, span(stage)), 0)
  const origin = (r: T) => (typeof r.metadata?.dataOrigin === 'string' ? r.metadata.dataOrigin : '')
  const sorted = records
    .filter(r => Number.isFinite(Date.parse(r.startTime)) && Number.isFinite(Date.parse(r.endTime)))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  const kept: T[] = []
  let night: T[] = []
  let end = -Infinity
  const close = () => {
    if (!night.length) return
    const totals = new Map<string, number>()
    for (const r of night) totals.set(origin(r), (totals.get(origin(r)) ?? 0) + staged(r))
    const [winner] = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    kept.push(...night.filter(r => origin(r) === winner))
    night = []
  }
  for (const r of sorted) {
    if (Date.parse(r.startTime) >= end) close()
    night.push(r)
    end = Math.max(end, Date.parse(r.endTime))
  }
  close()
  return kept
}

function metadataOf(r: unknown): { recordId?: string; origin?: string; device?: string } {
  const m = (r as { metadata?: unknown } | null)?.metadata as
    { id?: unknown; dataOrigin?: unknown; device?: { type?: unknown } | null } | null | undefined
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
  return { recordId: str(m?.id), origin: str(m?.dataOrigin), device: str(m?.device?.type) }
}

/**
 * `Steps` or `ActiveCaloriesBurned` records as interval rows, newest first.
 *
 * Field names are the plugin converter's (`patches/@devmaxime__capacitor-health-connect.patch`):
 * `StepsRecord` → `{ startTime, endTime, count }` (the unpatched plugin's own branch) and
 * `ActiveCaloriesBurnedRecord` → `{ startTime, endTime, kilocalories }` (#2462, from
 * `getEnergy().getKilocalories()` in the pinned connect-client 1.1.0-alpha11). Both carry
 * `metadata.{ id, dataOrigin, device.type }`. A record without an id, a parseable span or a finite
 * number is dropped here, never sent; plausibility is the server's (`/api/sync-health`).
 */
export function flattenIntervalRecords(kind: 'steps' | 'active_kcal', records: unknown[]): ActivityInterval[] {
  const valueKey = kind === 'steps' ? 'count' : 'kilocalories'
  const out: ActivityInterval[] = []
  for (const r of records) {
    const rec = r as { startTime?: unknown; endTime?: unknown; [k: string]: unknown } | null
    if (!rec || typeof rec !== 'object') continue
    const startMs = typeof rec.startTime === 'string' ? Date.parse(rec.startTime) : NaN
    const endMs = typeof rec.endTime === 'string' ? Date.parse(rec.endTime) : NaN
    const value = rec[valueKey]
    const { recordId, origin, device } = metadataOf(rec)
    if (!recordId || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out.push({ kind, startMs, endMs, value, recordId, ...(origin ? { origin } : {}), ...(device ? { device } : {}) })
  }
  return out.sort((a, b) => b.startMs - a.startMs)
}

/**
 * The samples inside `StepsCadenceSeries` records as `cadence_spm` rows (startMs = endMs), newest
 * first. The converter emits `samples[]` of `{ time, rate }` (#2462, `StepsCadenceRecord.Sample`'s
 * `getTime(): Instant` and `getRate(): double`). Every sample keeps its record's id; the server keys
 * on id + instant.
 */
export function flattenCadenceRecords(records: unknown[]): ActivityInterval[] {
  const out: ActivityInterval[] = []
  for (const r of records) {
    const samples = (r as { samples?: unknown } | null)?.samples
    if (!Array.isArray(samples)) continue
    const { recordId, origin, device } = metadataOf(r)
    if (!recordId) continue
    for (const s of samples as Array<{ time?: unknown; rate?: unknown }>) {
      const at = typeof s?.time === 'string' ? Date.parse(s.time) : NaN
      const rate = s?.rate
      if (!Number.isFinite(at) || typeof rate !== 'number' || !Number.isFinite(rate)) continue
      out.push({ kind: 'cadence_spm', startMs: at, endMs: at, value: rate, recordId, ...(origin ? { origin } : {}), ...(device ? { device } : {}) })
    }
  }
  return out.sort((a, b) => b.startMs - a.startMs)
}

/**
 * "YYYY-MM-DD" for `iso` in the USER's timezone.
 *
 * TN-44. This used to resolve `Intl.DateTimeFormat().resolvedOptions().timeZone` — the DEVICE's
 * zone — which is the class CLAUDE.md bans, and it is invisible until the phone leaves the zone the
 * data was recorded in. On a phone set to New York a Brisbane night's readings land on the previous
 * day, silently, for every record this module buckets.
 *
 * It was also a second implementation of `toAestDay`, which has taken a `tz` since it was written.
 * Delegating rather than keeping a local copy is the point.
 */
export function toLocalDate(iso: string, tz: string): string {
  return toAestDay(new Date(iso), tz);
}

/** Hour-of-day (0–23) for `iso` in the user's timezone — `getHours()` reads the DEVICE's. */
export function hourInTz(iso: string, tz: string): number {
  return Number(formatInTimeZone(new Date(iso), tz, 'H'));
}


/** Health Connect records are filtered by the app that wrote them (#3115). */
export type LegacyFirstHandFilter = FirstHandFilter<unknown>;

export function newFirstHandFilter(sources: FirstHandSources | null): LegacyFirstHandFilter {
  return new FirstHandFilter<unknown>(sources, r => metadataOf(r).origin, r => metadataOf(r).recordId);
}

/**
 * The only place the current app reads records from Health Connect (#3197). Every read goes through the
 * filter, so a read type added later cannot upload the Oura app's copies by forgetting to call it;
 * `health-connect-first-hand-3197.test.ts` fails on a second `readRecords` call in the current app. The daily aggregates
 * (`aggregateRecords`) are not records and cannot be split by app: Health Connect merges them by
 * its own app priority.
 */
async function readFiltered(
  hc: HealthConnectPlugin, filter: LegacyFirstHandFilter, args: { start: string; end: string; type: string },
): Promise<unknown[]> {
  const { records } = await hc.readRecords(args as Parameters<HealthConnectPlugin['readRecords']>[0]);
  return filter.keep(args.type, records);
}

// Per-session distance / calories / heart rate, used for both freshly-synced
// exercise sessions and for enriching activity logs created another way
// (e.g. manually logged) once Health Connect data for that window lands.
async function getSessionMetrics(
  hc: HealthConnectPlugin,
  canRead: Set<string>,
  start: string,
  end: string,
  filter: LegacyFirstHandFilter,
): Promise<{ distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number }> {
  const metrics: { distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number } = {};

  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await hc.aggregateRecords({ start, end, type: 'Distance' });
      const v = aggregates[0]?.value;
      if (v) metrics.distanceKm = Math.round((v / 1000) * 10) / 10;
    } catch { /* ignore */ }
  }

  if (canRead.has('TotalCaloriesBurned')) {
    try {
      const { aggregates } = await hc.aggregateRecords({ start, end, type: 'TotalCaloriesBurned' });
      const v = aggregates[0]?.value;
      if (v) metrics.caloriesBurned = Math.round(v);
    } catch { /* ignore */ }
  }

  if (canRead.has('HeartRateSeries')) {
    try {
      const records = await readFiltered(hc, filter, { start, end, type: 'HeartRateSeries' });
      const bpms: number[] = [];
      for (const r of records as Array<{ samples?: Array<{ beatsPerMinute: number }> }>) {
        for (const sample of r.samples ?? []) bpms.push(sample.beatsPerMinute);
      }
      if (bpms.length) {
        metrics.avgHr = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
        metrics.maxHr = Math.max(...bpms);
      }
    } catch { /* ignore */ }
  }

  return metrics;
}

export interface EnrichmentCandidate {
  id: string;
  date: string;
  startTime?: string; // "HH:MM", local time
  endTime?: string;   // "HH:MM", local time
}

/**
 * The UTC instant for a date + "HH:MM" wall time IN THE USER'S ZONE. `dayOffset` shifts the date
 * forward, used when a session's end time crosses midnight.
 *
 * #2438. This was `new Date(y, m - 1, d + dayOffset, h, mi)`, which reads the DEVICE's zone. LB-113
 * threaded the user's zone into `enrichActivityLogs` and this never took it, so on a phone set to
 * another zone the HR, distance and calorie enrichment read the wrong hours. The date is shifted as
 * a calendar string first, so the offset cannot be skewed by a DST change on the day.
 */
export function localDateTimeToIso(date: string, time: string, tz: string, dayOffset = 0): string {
  return fromZonedTime(`${shiftDateStr(date, dayOffset)}T${time}:00`, tz).toISOString();
}

/**
 * The sync window: the user's local midnight `daysBack - 1` days before today, to the user's local
 * midnight AFTER today.
 *
 * #2438. These were device-local midnights, while every bucket is dated in the user's zone
 * (`toLocalDate(…, tz)`). The old comment said device midnight is what keeps the plugin's 24-hour
 * aggregate windows on one calendar day, and that holds only when the two zones agree. The windows
 * must start at the midnight the BUCKETS are cut at, which is the user's.
 */
export function syncWindowIso(todayStr: string, daysBack: number, tz: string): { startIso: string; endIso: string } {
  return {
    startIso: dateStrMidnightInTz(shiftDateStr(todayStr, -(daysBack - 1)), tz).toISOString(),
    endIso: dateStrMidnightInTz(shiftDateStr(todayStr, 1), tz).toISOString(),
  };
}

/**
 * #3044. The local days `[startIso, endIso)` covers in full, for the server's deletion sweep, or
 * undefined when it does not begin and end on the user's midnights: a part-read day would read
 * the sessions outside the window as deleted. Both callers read whole days (`syncWindowIso`, the
 * history import's windows), so this is a guard, not a trim.
 */
export function exerciseSweepWindow(
  startIso: string, endIso: string, tz: string, leftOut: string[] = [],
): SyncPayload['exerciseWindow'] {
  const from = toLocalDate(startIso, tz);
  const to = toLocalDate(new Date(Date.parse(endIso) - 1).toISOString(), tz);
  if (dateStrMidnightInTz(from, tz).toISOString() !== new Date(startIso).toISOString()) return undefined;
  if (dateStrMidnightInTz(shiftDateStr(to, 1), tz).toISOString() !== new Date(endIso).toISOString()) return undefined;
  if (to < from) return undefined;
  return { from, to, ...(leftOut.length ? { leftOut } : {}) };
}

/** A session's start and end as the user's wall clock, "HH:MM". Without a zone `msToHHMMInTz` falls
 *  back to Brisbane, which stored every non-Brisbane user's sessions with the wrong clock (#2438). */
export function sessionClockTimes(startIso: string, endIso: string, tz: string): { startTime: string; endTime: string } {
  return { startTime: msToHHMMInTz(startIso, tz), endTime: msToHHMMInTz(endIso, tz) };
}

// Backfills HR/distance/calories on activity logs that were saved without
// them (e.g. manually logged before Health Connect's session data synced).
export async function enrichActivityLogs(
  candidates: EnrichmentCandidate[], tz: string = DEFAULT_TZ, firstHand: FirstHandSources | null = null,
): Promise<void> {
  if (!candidates.length) return;

  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;

  const { HealthConnect } = await import('@devmaxime/capacitor-health-connect');

  const { availability } = await HealthConnect.checkAvailability();
  if (availability !== 'Available') return;

  const perms = await HealthConnect.requestPermissions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: [...HC_ENRICH_READ_TYPES] as any,
    write: [],
  });
  const canRead: Set<string> = new Set(perms.read);
  const filter = newFirstHandFilter(firstHand);

  for (const c of candidates) {
    if (!c.startTime || !c.endTime) continue;
    const start = localDateTimeToIso(c.date, c.startTime, tz);
    const end = localDateTimeToIso(c.date, c.endTime, tz, c.endTime <= c.startTime ? 1 : 0);
    const metrics = await getSessionMetrics(HealthConnect, canRead, start, end, filter);
    if (!Object.keys(metrics).length) continue;

    try {
      await fetch(`/api/activity-logs/${c.id}/metrics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metrics),
      });
    } catch { /* ignore */ }
  }
}

/** What one sync of one window sends. `requests` counts the POSTs made to `/api/sync-health` (the
 *  route allows 60 a minute, which the history import paces itself against). `failed` is set when a
 *  series upload stopped early: the window did not fully land, so an import must not move past it. */
export interface SyncResult {
  metrics: number; sessions: number; sleep: number; heartRate: number; intervals: number;
  note?: string; requests?: number; failed?: boolean;
  /** #3197: a record read failed or the daily post was refused, so the window may be missing data. */
  incomplete?: boolean;
  /** #3115: records left out as copies of data read first-hand, per Health Connect type. Counts only. */
  skippedFirstHand?: Record<string, number>;
}

/**
 * `connectedSources` from today's cached readiness payload, by the one cold-start rule shared with
 * Preview (`knownFirstHandSources`, #3197): nothing cached, the mirror cleared by
 * `invalidateCache('readiness-score')`, or a payload from an earlier day is unknown, and unknown
 * keeps Oura's copies.
 */
export async function cachedFirstHandSources(tz: string = DEFAULT_TZ): Promise<FirstHandSources | null> {
  try {
    const { readCacheSync } = await import('@/lib/sqlite/cache');
    const stored = readCacheSync<unknown>('readiness-score');
    // `cachedFetchToday` stores `{ date, data }`; an older entry is the payload itself, which has no
    // date to trust and so reads as unknown.
    if (!stored || typeof stored !== 'object' || !('date' in stored) || !('data' in stored)) return null;
    const { date, data } = stored as { date: unknown; data: unknown };
    return knownFirstHandSources((data as { connectedSources?: unknown } | null)?.connectedSources, date, todayInTz(tz));
  } catch {
    return null;
  }
}

/** An open, permission-checked Health Connect: the plugin and the record types the user granted. */
export interface HealthConnectSession { HealthConnect: HealthConnectPlugin; canRead: Set<string> }

/** Open Health Connect for a sync. `null` off the native app; `{ note }` when the platform cannot
 *  serve it (not installed, needs an update). Shared by the ordinary sync and the history import so
 *  the two request the same permissions. */
export async function openHealthConnect(): Promise<HealthConnectSession | { note: string } | null> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return null;

  const { HealthConnect } = await import('@devmaxime/capacitor-health-connect');

  const { availability } = await HealthConnect.checkAvailability();
  if (availability !== 'Available') return { note: `HC ${availability}` };

  const perms = await HealthConnect.requestPermissions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: [...HC_SYNC_READ_TYPES] as any,
    write: [],
  });
  return { HealthConnect, canRead: new Set(perms.read) };
}

/** Local date of the oldest window whose Oura records were skipped, kept until a rewind sync finishes cleanly. */
export const SKIPPED_SINCE_KEY = 'ta_hc_first_hand_skipped_since';
/** The last sync's skip counts: replaced on every sync, so they are that sync's and never a running total. */
export const LAST_SKIPPED_KEY = 'ta_hc_last_skipped';

export function readLastSyncSkipped(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_SKIPPED_KEY) ?? 'null') as { counts?: Record<string, number> } | null;
    return raw?.counts ?? {};
  } catch {
    return {};
  }
}

/** Where a sync reports what it left out: the provider calls this with every result (#3197). */
export function rememberSyncSkipped(result: SyncResult | null): void {
  if (!result) return;
  try {
    localStorage.setItem(LAST_SKIPPED_KEY, JSON.stringify({ at: new Date().toISOString(), counts: result.skippedFirstHand ?? {} }));
  } catch { /* storage unavailable: the counts are diagnostics only */ }
}

export async function syncHealthConnect(tz: string = DEFAULT_TZ): Promise<SyncResult | null> {
  const opened = await openHealthConnect();
  if (!opened) return null;
  if ('note' in opened) return { metrics: 0, sessions: 0, sleep: 0, heartRate: 0, intervals: 0, note: opened.note };

  // #3197: records skipped while Oura Cloud was connected are not read again by a 7-day hot sync.
  // Once the connection reads as gone, the next sync reaches back to the oldest skipped day, at most
  // the cold 30 days (all Health Connect lets us read without the history permission), so they come
  // back. Server-side Oura Cloud rows stay either way.
  const firstHand = await cachedFirstHandSources(tz);
  const todayStr = todayInTz(tz);
  const skippedSince = localStorage.getItem(SKIPPED_SINCE_KEY);
  const rewind = firstHand?.ouraCloud === false && skippedSince !== null;
  const lastSync  = localStorage.getItem(LAST_SYNC_KEY);
  const rewindDays = skippedSince && isCalendarDate(skippedSince)
    ? Math.min(SYNC_DAYS_COLD, Math.max(SYNC_DAYS_HOT, daysBetweenDateStrs(skippedSince, todayStr) + 1))
    : SYNC_DAYS_COLD;
  const daysBack  = rewind ? rewindDays : lastSync ? SYNC_DAYS_HOT : SYNC_DAYS_COLD;

  // Align the query window to the USER's calendar day boundaries. The plugin loops over 24h windows
  // from `startInstant`, so if start isn't a local midnight the windows straddle two calendar days
  // and aggregate steps from both into one bucket. Every bucket below is dated in `tz`, so the
  // midnight has to be `tz`'s, not the device's (#2438).
  const { startIso, endIso } = syncWindowIso(todayStr, daysBack, tz);

  const result = await syncWindow(opened, tz, startIso, endIso, {
    firstHand,
    onPosted: () => localStorage.setItem(LAST_SYNC_KEY, endIso),
  });
  // `onPosted` runs before the heart-rate and interval uploads, so the marker is cleared here, once
  // the whole window has landed. A failed upload or a failed read keeps it for the next sync.
  if (rewind && !result.failed && !result.incomplete) localStorage.removeItem(SKIPPED_SINCE_KEY);
  else if (result.skippedFirstHand && skippedSince === null) localStorage.setItem(SKIPPED_SINCE_KEY, toLocalDate(startIso, tz));
  return result;
}

/**
 * Read one window out of Health Connect and send it through `/api/sync-health`: the same reads and
 * the same ranked-merge writes (`upsertBodyMetrics`, `saveSleepSession`) whether the window is the
 * last 7 days or a month from last year, so a later live sync of an overlapping day merges rather
 * than double-counts (issue 2169). `opts.historyFrom` marks an explicit history import;
 * `opts.onPosted` runs once the window's daily payload has landed (or there was nothing to send).
 */
export async function syncWindow(
  { HealthConnect, canRead }: HealthConnectSession, tz: string, startIso: string, endIso: string,
  opts: { historyFrom?: string; onPosted?: () => void; firstHand?: FirstHandSources | null } = {},
): Promise<SyncResult> {
  const { historyFrom, onPosted } = opts;
  const dayBuckets: Record<string, DailyMetric> = {};

  // #3115: while Oura Cloud is connected, the Oura app's own records are a second copy of what the
  // server reads from Oura's API, so they are left out, and counted. The daily aggregates (steps,
  // distance, total calories) cannot be split by app: Health Connect merges them by its own app
  // priority, which already keeps one app per moment.
  const firstHand = opts.firstHand !== undefined ? opts.firstHand : await cachedFirstHandSources(tz);
  const filter = newFirstHandFilter(firstHand);
  let readFailed = false;
  const read = (type: string) => readFiltered(HealthConnect, filter, { start: startIso, end: endIso, type })
    .catch(err => { readFailed = true; throw err; });
  function bucket(date: string): DailyMetric {
    if (!dayBuckets[date]) dayBuckets[date] = { date };
    return dayBuckets[date];
  }

  // ── Steps (aggregate by day) ──────────────────────────────────────────────
  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'Steps', groupBy: 'day',
      });
      for (const a of aggregates) {
        const v = Math.round(a.value);
        if (v > 0) bucket(toLocalDate(a.startTime, tz)).steps = v;
      }
    } catch { /* permission denied */ }
  }

  // ── Distance (aggregate by day, m → km) ───────────────────────────────────
  if (canRead.has('Steps')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'Distance', groupBy: 'day',
      });
      // #2828 N7. The plugin reports a day with no records as 0 (`?: 0.0`), so a 0 is "nothing
      // recorded" and writes nothing, as steps already did. Otherwise every day stamps 0 km.
      for (const a of aggregates) {
        const km = Math.round((a.value / 1000) * 10) / 10;
        if (km > 0) bucket(toLocalDate(a.startTime, tz)).distanceKm = km;
      }
    } catch { /* ignore */ }
  }

  // ── Calories burned (aggregate by day) ────────────────────────────────────
  if (canRead.has('TotalCaloriesBurned')) {
    try {
      const { aggregates } = await HealthConnect.aggregateRecords({
        start: startIso, end: endIso, type: 'TotalCaloriesBurned', groupBy: 'day',
      });
      // #2828 N7, as for distance.
      for (const a of aggregates) {
        const kcal = Math.round(a.value);
        if (kcal > 0) bucket(toLocalDate(a.startTime, tz)).caloriesBurned = kcal;
      }
    } catch { /* ignore */ }
  }

  // ── Weight (latest per day) ───────────────────────────────────────────────
  if (canRead.has('Weight')) {
    try {
      const records = await read('Weight');
      for (const r of records as Array<{ time: string; value: number }>)
        bucket(toLocalDate(r.time, tz)).weightKg = Math.round(r.value * 100) / 100;
    } catch { /* ignore */ }
  }

  // ── Body fat % (latest per day) ───────────────────────────────────────────
  if (canRead.has('BodyFat')) {
    try {
      const records = await read('BodyFat');
      for (const r of records as Array<{ time: string; percentage: number }>)
        bucket(toLocalDate(r.time, tz)).bodyFatPct = Math.round(r.percentage * 10) / 10;
    } catch { /* ignore */ }
  }

  // ── Nutrition macros (sum per day) ────────────────────────────────────────
  if (canRead.has('Nutrition')) {
    try {
      const records = await read('Nutrition');
      for (const r of records as Array<{
        startTime: string; calories?: number;
        proteinG?: number; carbsG?: number; fatG?: number;
      }>) {
        const b = bucket(toLocalDate(r.startTime, tz));
        if (r.calories  != null) b.calories  = (b.calories  ?? 0) + Math.round(r.calories);
        if (r.proteinG  != null) b.proteinG  = (b.proteinG  ?? 0) + Math.round(r.proteinG  * 10) / 10;
        if (r.carbsG    != null) b.carbsG    = (b.carbsG    ?? 0) + Math.round(r.carbsG    * 10) / 10;
        if (r.fatG      != null) b.fatG      = (b.fatG      ?? 0) + Math.round(r.fatG      * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── Resting heart rate (daily measurement from wearable) ─────────────────
  if (canRead.has('RestingHeartRate')) {
    try {
      const records = await read('RestingHeartRate');
      for (const r of records as Array<{ time: string; beatsPerMinute: number }>) {
        bucket(toLocalDate(r.time, tz)).restingHeartRate = Math.round(r.beatsPerMinute);
      }
    } catch { /* ignore */ }
  }

  // ── HRV (mean overnight RMSSD, midnight–8am) ─────────────────────────────
  if (canRead.has('HeartRateVariabilityRmssd')) {
    try {
      const records = await read('HeartRateVariabilityRmssd');
      const overnightHrv: Record<string, number[]> = {};
      for (const r of records as Array<{ time: string; heartRateVariabilityMillis: number }>) {
        const h = hourInTz(r.time, tz);
        if (h >= 0 && h < 8) {
          const date = toLocalDate(r.time, tz);
          if (!overnightHrv[date]) overnightHrv[date] = [];
          overnightHrv[date].push(r.heartRateVariabilityMillis);
        }
      }
      for (const [date, vals] of Object.entries(overnightHrv)) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        bucket(date).hrvMs = Math.round(mean * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── SpO2 (daily mean of overnight readings, midnight–8am) ────────────────
  if (canRead.has('OxygenSaturation')) {
    try {
      const records = await read('OxygenSaturation');
      const overnightSpo2: Record<string, number[]> = {};
      for (const r of records as Array<{ time: string; percentage: number }>) {
        const h = hourInTz(r.time, tz);
        if (h >= 0 && h < 8) {
          const date = toLocalDate(r.time, tz);
          if (!overnightSpo2[date]) overnightSpo2[date] = [];
          overnightSpo2[date].push(r.percentage);
        }
      }
      for (const [date, vals] of Object.entries(overnightSpo2)) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        bucket(date).spo2Pct = Math.round(mean * 10) / 10;
      }
    } catch { /* ignore */ }
  }

  // ── Exercise sessions ─────────────────────────────────────────────────────
  const exerciseSessions: ExerciseSession[] = [];
  let exerciseWindow: SyncPayload['exerciseWindow'];
  if (canRead.has('ActivitySession')) {
    try {
      const records = await read('ActivitySession');
      for (const r of records as Array<{ startTime: string; endTime: string; exerciseType: string; title?: string }>) {
        const durationMin = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000;
        const metrics = await getSessionMetrics(HealthConnect, canRead, r.startTime, r.endTime, filter);
        const { recordId, origin } = metadataOf(r);
        exerciseSessions.push({
          date:         toLocalDate(r.startTime, tz),
          title:        r.title?.trim() || exerciseTypeLabel(r.exerciseType),
          activityType: mapExerciseTypeToActivityType(r.exerciseType),
          ...sessionClockTimes(r.startTime, r.endTime, tz),
          durationMin:  Math.round(durationMin * 10) / 10,
          ...metrics,
          ...(recordId ? { recordId } : {}),
          ...(origin ? { origin } : {}),
        });
      }
      // Only once every session in the window is in hand: a read that threw part-way says nothing
      // about the sessions it did not reach.
      exerciseWindow = exerciseSweepWindow(startIso, endIso, tz, filter.leftOutIds('ActivitySession'));
    } catch { /* ignore */ }
  }

  // ── Sleep sessions ────────────────────────────────────────────────────────
  const sleepRecords: SleepRecord[] = [];
  if (canRead.has('SleepSession')) {
    try {
      const records = await read('SleepSession');
      // #3115: one app per night, so Samsung Health's and the Oura app's copies of one night are
      // not sent as two nights that the server would read as two fragments of it.
      for (const r of oneAppPerNight(records as HcSleepRecord[]) as Array<{
        startTime: string; endTime: string;
        stages?: Array<{ startTime: string; endTime: string; stage: string }>;
      }>) {
        const startMs = new Date(r.startTime).getTime();
        const endMs   = new Date(r.endTime).getTime();
        const durationHours = (endMs - startMs) / 3600000;
        // One pass builds both the four totals and the timed intervals the hypnogram needs, so
        // the two can't disagree about what a stage string means.
        const intervals: StageInterval[] = (r.stages ?? []).map(stage => ({
          startMs: new Date(stage.startTime).getTime(),
          endMs:   new Date(stage.endTime).getTime(),
          stage:   HC_STAGE_TO_SLEEP_STAGE[stage.stage] ?? null,
        }));
        let deep = 0, rem = 0, light = 0, awake = 0;
        for (const iv of intervals) {
          const h = (iv.endMs - iv.startMs) / 3600000;
          if      (iv.stage === 'deep')  deep  += h;
          else if (iv.stage === 'rem')   rem   += h;
          else if (iv.stage === 'light') light += h;
          else if (iv.stage === 'awake') awake += h;
        }
        const round = (n: number) => Math.round(n * 100) / 100;
        sleepRecords.push({
          date:            toLocalDate(r.endTime, tz),
          sleepStart:      r.startTime,
          sleepEnd:        r.endTime,
          durationHours:   round(durationHours),
          deepSleepHours:  deep  > 0 ? round(deep)  : undefined,
          remSleepHours:   rem   > 0 ? round(rem)   : undefined,
          lightSleepHours: light > 0 ? round(light) : undefined,
          awakHours:       awake > 0 ? round(awake) : undefined,
          sleepPhase5Min:  intervalsToPhase5Min(intervals, startMs, endMs) ?? undefined,
        });
      }
    } catch { /* ignore */ }
  }

  // ── Heart-rate series (#2168) ─────────────────────────────────────────────
  // Into the shared HR table, where a ring or strap row covering the same minutes wins at read time
  // and this one is kept. The read is not wrapped in a silent catch like the ones above: a
  // HeartRateSeries read that fails while the permission is granted is a fault worth a log line.
  let heartRateSamples: HeartRateSample[] = [];
  if (canRead.has('HeartRateSeries')) {
    try {
      const records = await read('HeartRateSeries');
      heartRateSamples = flattenHeartRateRecords(records);
    } catch (err) {
      console.warn('[health-connect] HeartRateSeries read failed:', err);
    }
  }

  // ── Per-interval steps, active calories and cadence (#2462) ──────────────
  // The daily aggregates above stay: Health Connect's aggregate de-duplicates across apps, which
  // these raw records do not (the server keeps every app's rows and the reader de-duplicates). Like
  // the HR read, a failure with the permission granted is worth a log line, not a silent catch.
  const activityIntervals: ActivityInterval[] = [];
  const readIntervals = async (type: 'Steps' | 'ActiveCaloriesBurned' | 'StepsCadenceSeries') => {
    try {
      const records = await read(type);
      activityIntervals.push(...(type === 'StepsCadenceSeries'
        ? flattenCadenceRecords(records)
        : flattenIntervalRecords(type === 'Steps' ? 'steps' : 'active_kcal', records)));
    } catch (err) {
      console.warn(`[health-connect] ${type} read failed:`, err);
    }
  };
  if (canRead.has('Steps')) {
    await readIntervals('Steps');
    await readIntervals('StepsCadenceSeries');  // READ_STEPS — see HC_SYNC_READ_TYPES
  }
  if (canRead.has('ActiveCaloriesBurned')) await readIntervals('ActiveCaloriesBurned');
  activityIntervals.sort((a, b) => b.startMs - a.startMs);

  const dailyMetrics = Object.values(dayBuckets);
  const counts = filter.counts();
  const skipped = Object.keys(counts).length ? { skippedFirstHand: counts } : {};
  const hasDaily = dailyMetrics.length > 0 || exerciseSessions.length > 0 || sleepRecords.length > 0 || exerciseWindow != null;
  if (!hasDaily && !heartRateSamples.length && !activityIntervals.length) {
    onPosted?.();
    return { metrics: 0, sessions: 0, sleep: 0, heartRate: 0, intervals: 0, note: 'no data from HC', requests: 0, ...(readFailed ? { incomplete: true } : {}), ...skipped };
  }

  let enrichmentCandidates: EnrichmentCandidate[] | undefined;
  let dailyNote: string | undefined;
  let dailyRefused = false;
  let requests = 0;
  if (hasDaily) {
    requests += 1;
    const res = await fetch('/api/sync-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dailyMetrics, exerciseSessions, sleepRecords,
        ...(historyFrom ? { historyFrom } : {}),
        ...(exerciseWindow ? { exerciseWindow } : {}),
      } satisfies SyncPayload),
    });

    if (res.ok) {
      ({ enrichmentCandidates } = await res.json() as { enrichmentCandidates?: EnrichmentCandidate[] });
    } else if (res.status === 400 || res.status === 413) {
      // #2828 N3. The server refuses this payload the same way every time, so throwing here (before
      // `onPosted`) re-sent it on every sync until its records aged out of the window, and skipped the
      // heart-rate and interval uploads below each time. Bad records are now refused one by one, so
      // only a payload whose shape is wrong gets here; it is noted and the sync moves on.
      // #3197: it also marks the window `incomplete`, so a payload that keeps being refused keeps the
      // rewind marker and every sync stays a rewind (up to 30 days) until one posts clean. That costs
      // time, not data.
      dailyRefused = true;
      dailyNote = `daily payload refused (sync-health ${res.status})`;
      console.warn(`[health-connect] ${dailyNote}: ${await res.text()}`);
    } else {
      throw new Error(`sync-health ${res.status}: ${await res.text()}`);
    }
  }

  onPosted?.();

  const heartRate = await uploadSeries('heartRateSamples', heartRateSamples, HR_UPLOAD_CHUNK, HR_UPLOAD_MAX_CHUNKS, 'heart rate', 'samples', historyFrom);
  const intervals = await uploadSeries('activityIntervals', activityIntervals, INTERVAL_UPLOAD_CHUNK, INTERVAL_UPLOAD_MAX_CHUNKS, 'intervals', 'rows', historyFrom);
  requests += heartRate.requests + intervals.requests;
  const note = [dailyNote, heartRate.note, intervals.note].filter(Boolean).join('; ');

  if (enrichmentCandidates?.length) {
    // `tz`, not the default — this call is INSIDE `syncHealthConnect`, so the timezone the caller
    // passed is already in scope and dropping it here would leave enrichment bucketing in Brisbane
    // however carefully the component threaded it (LB-113).
    try { await enrichActivityLogs(enrichmentCandidates, tz, firstHand); } catch { /* ignore */ }
  }

  return {
    metrics: dailyMetrics.length, sessions: exerciseSessions.length, sleep: sleepRecords.length,
    heartRate: heartRate.sent, intervals: intervals.sent, requests,
    ...(heartRate.failed || intervals.failed ? { failed: true } : {}),
    ...(readFailed || dailyRefused ? { incomplete: true } : {}),
    ...(note ? { note } : {}),
    ...skipped,
  };
}

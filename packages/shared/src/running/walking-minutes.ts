import { CADENCE_SERIES_BIN_SEC, isPlausibleCadence } from '../health/cadence'
import { DEFAULT_MAX_GAP_SEC, type HrReading } from '../health/zone-minutes'

/**
 * Issue 3779. What counts as an active minute on the walking plan — the ONE place that decides it.
 * Signed by the owner on 15 Nov 2026 ("targets as written", the proposal of 14 Nov 22:20Z).
 *
 * 1. Where heart rate is dense enough (consecutive readings no more than 2 minutes apart, the
 *    zone-minutes gap `DEFAULT_MAX_GAP_SEC`): unchanged from the heart-health rule (#2746), a
 *    second counts at or above the moderate-effort floor, 40% of heart-rate reserve.
 * 2. Where it is thin (the usual case since the ring moved to Oura Cloud, #3775), inside a walk,
 *    treadmill session, hike or run only:
 *    - a second counts when the recording's cadence there is 100 steps a minute or more;
 *    - with no cadence, when the activity's average speed is 4.8 km/h or more;
 *    - with neither, it counts half, and the minutes are marked estimated.
 * 3. Steps outside any activity never make active minutes (they feed the steps target only), so
 *    nothing here reads a day's step count.
 * 4. Every result says which rule judged it (`basis`), so a card can say "from heart rate",
 *    "from cadence", "from pace" or "estimated".
 *
 * Reads only the generic activity shape (connector guide §3d) plus the merged heart-rate series
 * (§3a): never a source id or a vendor field. Stores nothing and moves no score.
 */

/** Cadence at or above which a minute is moderate walking (the common research line). */
export const MODERATE_CADENCE_SPM = 100
/** Average speed at or above which a minute is moderate walking (about 3 mph). */
export const MODERATE_SPEED_KMH = 4.8
/** The share of an activity's thin minutes credited when neither cadence nor speed is known. */
export const ESTIMATED_MINUTE_SHARE = 0.5
/** The largest gap between two heart-rate readings that still counts as dense (seconds). */
export const DENSE_HR_MAX_GAP_SEC = DEFAULT_MAX_GAP_SEC

/** Activity types whose thin stretches the cadence, speed and estimate rules may count (rule 2).
 *  An explicit list, so a ride or a gym session never earns walking minutes without heart rate. */
export const THIN_RULE_ACTIVITY_TYPES: readonly string[] = ['walk', 'treadmill', 'hike', 'run']

export type ActiveMinuteBasis = 'heart_rate' | 'cadence' | 'speed' | 'estimated'

export interface ActiveMinutesBySource {
  heartRate: number
  cadence: number
  speed: number
  estimated: number
}

/** One logged activity as the counting rule sees it (connector guide §3d). */
export interface WalkingActivityInput {
  id: string
  activityType: string
  durationMin: number | null
  distanceKm: number | null
  /** Average cadence over the recording, used only when it has no per-bin series. */
  cadenceSpm: number | null
  /** Per-bin cadence, `tSec` from the activity's start, each bin `CADENCE_SERIES_BIN_SEC` long. */
  cadenceSeries: readonly { tSec: number; spm: number }[] | null
  /** The instants the activity covers, or null when it has no start time to place it. */
  window: { fromMs: number; toMs: number } | null
}

export interface ActivityActiveMinutes {
  id: string
  activityType: string
  durationMin: number | null
  /** Active minutes, rounded, with estimated seconds already at their half weight. */
  minutes: number
  /** The rule that judged the most of the activity, or null when none judged any of it. */
  basis: ActiveMinuteBasis | null
  /** Minutes counted under each rule (rounded each; may not sum exactly to `minutes`). */
  bySource: ActiveMinutesBySource
}

const EMPTY_BY_SOURCE: ActiveMinutesBySource = { heartRate: 0, cadence: 0, speed: 0, estimated: 0 }

/** Average speed from distance and duration, or null when either is missing. */
export function averageSpeedKmh(distanceKm: number | null, durationMin: number | null): number | null {
  if (distanceKm == null || durationMin == null || !(distanceKm > 0) || !(durationMin > 0)) return null
  return distanceKm / (durationMin / 60)
}

const KEYS: Record<ActiveMinuteBasis, keyof ActiveMinutesBySource> = {
  heart_rate: 'heartRate', cadence: 'cadence', speed: 'speed', estimated: 'estimated',
}

/** The basis that judged the most seconds. Ties go to the stronger evidence (the order below). */
function dominantBasis(judged: Record<ActiveMinuteBasis, number>): ActiveMinuteBasis | null {
  let best: ActiveMinuteBasis | null = null
  for (const b of ['heart_rate', 'cadence', 'speed', 'estimated'] as const) {
    if (judged[b] > 0 && (best == null || judged[b] > judged[best])) best = b
  }
  return best
}

/**
 * Active minutes inside one activity, second by second. `readings` is the merged heart-rate series
 * across the activity's window (any order); `floorBpm` is `heartHealthFloorBpm(profile)`.
 */
export function activeMinutesForActivity(
  activity: WalkingActivityInput,
  readings: readonly HrReading[],
  floorBpm: number,
): ActivityActiveMinutes {
  const base = { id: activity.id, activityType: activity.activityType, durationMin: activity.durationMin }
  const windowSec = activity.window ? Math.floor((activity.window.toMs - activity.window.fromMs) / 1000) : 0
  const totalSec = windowSec > 0
    ? windowSec
    : activity.durationMin != null && activity.durationMin > 0 ? Math.round(activity.durationMin * 60) : 0
  if (totalSec <= 0) return { ...base, minutes: 0, basis: null, bySource: { ...EMPTY_BY_SOURCE } }

  const thinEligible = THIN_RULE_ACTIVITY_TYPES.includes(activity.activityType.toLowerCase())
  const speed = averageSpeedKmh(activity.distanceKm, activity.durationMin ?? (windowSec > 0 ? windowSec / 60 : null))
  const series = (activity.cadenceSeries ?? [])
    .filter((p) => Number.isFinite(p.tSec) && Number.isFinite(p.spm))
    .slice()
    .sort((a, b) => a.tSec - b.tSec)
  const avgCadence = series.length === 0 && activity.cadenceSpm != null && isPlausibleCadence(activity.cadenceSpm)
    ? activity.cadenceSpm
    : null
  // Heart rate can only be placed against an activity with a window.
  const hr = activity.window
    ? readings.filter((r) => Number.isFinite(r.timestamp) && Number.isFinite(r.bpm)).slice().sort((a, b) => a.timestamp - b.timestamp)
    : []

  const counted: Record<ActiveMinuteBasis, number> = { heart_rate: 0, cadence: 0, speed: 0, estimated: 0 }
  const judged: Record<ActiveMinuteBasis, number> = { heart_rate: 0, cadence: 0, speed: 0, estimated: 0 }
  let hi = 0 // heart-rate pointer: hr[hi] is the last reading at or before the current second
  let ci = 0 // cadence pointer, the same way
  const fromMs = activity.window?.fromMs ?? 0

  for (let s = 0; s < totalSec; s++) {
    // Rule 1: dense heart rate. The second belongs to the interval of its EARLIER reading, as in
    // `accumulateZoneSeconds`, and only an interval of at most two minutes is dense.
    if (hr.length >= 2) {
      const t = fromMs + s * 1000
      while (hi + 1 < hr.length && hr[hi + 1].timestamp <= t) hi++
      const cur = hr[hi]
      const next = hr[hi + 1]
      if (next && cur.timestamp <= t && next.timestamp - cur.timestamp <= DENSE_HR_MAX_GAP_SEC * 1000) {
        judged.heart_rate++
        if (cur.bpm >= floorBpm) counted.heart_rate++
        continue
      }
    }
    // Rule 2: thin heart rate, inside a foot activity only.
    if (!thinEligible) continue
    if (series.length > 0) {
      while (ci + 1 < series.length && series[ci + 1].tSec <= s) ci++
      const bin = series[ci]
      if (bin.tSec <= s && s < bin.tSec + CADENCE_SERIES_BIN_SEC && isPlausibleCadence(bin.spm)) {
        judged.cadence++
        if (bin.spm >= MODERATE_CADENCE_SPM) counted.cadence++
        continue
      }
    } else if (avgCadence != null) {
      judged.cadence++
      if (avgCadence >= MODERATE_CADENCE_SPM) counted.cadence++
      continue
    }
    if (speed != null) {
      judged.speed++
      if (speed >= MODERATE_SPEED_KMH) counted.speed++
      continue
    }
    judged.estimated++
    counted.estimated += ESTIMATED_MINUTE_SHARE
  }

  const totalCounted = counted.heart_rate + counted.cadence + counted.speed + counted.estimated
  const bySource = { ...EMPTY_BY_SOURCE }
  for (const b of Object.keys(KEYS) as ActiveMinuteBasis[]) bySource[KEYS[b]] = Math.round(counted[b] / 60)
  return { ...base, minutes: Math.round(totalCounted / 60), basis: dominantBasis(judged), bySource }
}

export interface DayActiveMinutes {
  minutes: number
  basis: ActiveMinuteBasis | null
  bySource: ActiveMinutesBySource
  /** The activity with the most active minutes, the one a completion links. Null when none has any. */
  creditedId: string | null
}

/** A day's active minutes: the sum over its activities, with the day's basis taken from whichever
 *  rule counted the most minutes across them (estimated loses a tie, so a card never says
 *  "estimated" when a measured rule did as much). */
export function dayActiveMinutes(activities: readonly ActivityActiveMinutes[]): DayActiveMinutes {
  const bySource = { ...EMPTY_BY_SOURCE }
  let minutes = 0
  let credited: ActivityActiveMinutes | null = null
  for (const a of activities) {
    minutes += a.minutes
    bySource.heartRate += a.bySource.heartRate
    bySource.cadence += a.bySource.cadence
    bySource.speed += a.bySource.speed
    bySource.estimated += a.bySource.estimated
    if (a.minutes > 0 && (credited == null || a.minutes > credited.minutes)) credited = a
  }
  let basis: ActiveMinuteBasis | null = null
  for (const b of ['heart_rate', 'cadence', 'speed', 'estimated'] as const) {
    const v = bySource[KEYS[b]]
    if (v > 0 && (basis == null || v > bySource[KEYS[basis]])) basis = b
  }
  return { minutes, basis, bySource, creditedId: credited?.id ?? null }
}

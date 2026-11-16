// The single shared "time-in-HR-zone" primitive — zone-second accumulation + Edwards-TRIMP
// "Session Load". Both the per-workout zone breakdown and the day/week/month time-in-zone stats
// import from here (One Formula, One Place). Zones come only from `hr-zones.ts`; never re-band here.
// "Session Load" is the per-workout HR number — distinct from whole-day "Training Stress (OTS)".
//
// How much of the gap between two readings counts is decided once, by `creditedGapSec` below, and
// every loop over a heart-rate series (zone seconds, WHO active minutes, heart-health minutes) reads
// it. Two copies of the cap would be two answers to "how long was I in zone 2?".
import { zoneForBpm, whoMinuteWeightForZone, type HrZone } from './hr-zones'

export interface HrReading {
  /** epoch ms */
  timestamp: number
  bpm: number
}

/** Default cap for the gap between two consecutive readings (seconds). A ring samples ~1/min; a
 *  strap faster. Anything longer than this is a data gap (ring asleep, no wear) and must not inflate
 *  a zone — cap it. Outside a workout or activity window this is the cap (#3775). */
export const DEFAULT_MAX_GAP_SEC = 120

/** The largest gap between two readings that still reads as dense: 5 minutes plus 30 s of slack
 *  (#2437, #3078). Oura Cloud's heart rate arrives every few minutes, and this is the line the
 *  density rule draws (`isDenseHrSpan`, `dropSparseHrHours`). Defined here, where the gap cap lives;
 *  `intraday-hr-contributors.ts` re-exports it for its existing readers. */
export const HR_DENSE_MAX_GAP_MS = 5 * 60_000 + 30_000

/** The cap inside a workout or activity window (#3775 item 3, owner 16 Nov 2026): a gap the density
 *  rule accepts counts in full there. All-day time outside every window keeps `DEFAULT_MAX_GAP_SEC`. */
export const ACTIVITY_WINDOW_MAX_GAP_SEC = HR_DENSE_MAX_GAP_MS / 1000

/** A workout or activity as instants (epoch ms), `fromMs` < `toMs`. */
export interface HrWindow {
  fromMs: number
  toMs: number
}

/** Where the series sits against workout and activity windows. `'all'` says the whole series is one
 *  activity's own readings (a workout's or activity's detail screen, a heart-health activity), so
 *  every gap is inside. A list is the windows that fall on an all-day series. Left out, no gap is
 *  inside a window. */
export type ActivityWindows = 'all' | readonly HrWindow[]

export interface GapOptions {
  windows?: ActivityWindows
  /** Overrides `DEFAULT_MAX_GAP_SEC`, the cap outside windows. Tests only. */
  maxGapSec?: number
}

type PreparedWindows = 'all' | HrWindow[]

/** Sorted and merged, so an overlap of two windows is never counted twice. Drops empty windows. */
function prepareWindows(windows: ActivityWindows | undefined): PreparedWindows {
  if (windows === 'all') return 'all'
  const sorted = (windows ?? [])
    .filter(w => Number.isFinite(w.fromMs) && Number.isFinite(w.toMs) && w.toMs > w.fromMs)
    .map(w => ({ fromMs: w.fromMs, toMs: w.toMs }))
    .sort((a, b) => a.fromMs - b.fromMs)
  const merged: HrWindow[] = []
  for (const w of sorted) {
    const last = merged[merged.length - 1]
    if (last && w.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, w.toMs)
    else merged.push(w)
  }
  return merged
}

function insideSec(t0: number, t1: number, windows: PreparedWindows): number {
  if (windows === 'all') return (t1 - t0) / 1000
  let ms = 0
  for (const w of windows) {
    if (w.fromMs >= t1) break
    const lo = Math.max(t0, w.fromMs)
    const hi = Math.min(t1, w.toMs)
    if (hi > lo) ms += hi - lo
  }
  return ms / 1000
}

/**
 * Seconds credited to the interval between two readings at `t0` and `t1` (epoch ms), the interval
 * belonging to the earlier reading (#3775 item 3, owner 16 Nov 2026):
 * - wholly outside every window: the gap, capped at `DEFAULT_MAX_GAP_SEC` (2 min), as it always was;
 * - wholly inside a window: the gap, capped at `ACTIVITY_WINDOW_MAX_GAP_SEC` (5½ min);
 * - across a window's edge: the part inside counts up to 5½ min and the part outside up to 2 min,
 *   and the two together never more than 5½ min, so a gap that touches a window never counts more
 *   than one wholly inside it would.
 * A non-positive gap credits nothing.
 */
function creditGap(t0: number, t1: number, windows: PreparedWindows, maxGapSec: number): number {
  const gap = (t1 - t0) / 1000
  if (!(gap > 0)) return 0
  const inside = Math.min(insideSec(t0, t1, windows), gap)
  if (inside <= 0) return Math.min(gap, maxGapSec)
  const outside = gap - inside
  return Math.min(
    Math.min(inside, ACTIVITY_WINDOW_MAX_GAP_SEC) + Math.min(outside, maxGapSec),
    ACTIVITY_WINDOW_MAX_GAP_SEC,
  )
}

/** Public form of the gap rule for a single interval; see `creditGap`. */
export function creditedGapSec(t0: number, t1: number, options: GapOptions = {}): number {
  return creditGap(t0, t1, prepareWindows(options.windows), options.maxGapSec ?? DEFAULT_MAX_GAP_SEC)
}

/** Calls `visit` with each interval's earlier reading and its credited seconds (`creditGap`). The
 *  one loop every series roll-up in this package walks. */
export function forEachCreditedInterval(
  readings: readonly HrReading[],
  options: GapOptions,
  visit: (earlier: HrReading, sec: number) => void,
): void {
  const windows = prepareWindows(options.windows)
  const maxGapSec = options.maxGapSec ?? DEFAULT_MAX_GAP_SEC
  for (let i = 0; i + 1 < readings.length; i++) {
    const sec = creditGap(readings[i].timestamp, readings[i + 1].timestamp, windows, maxGapSec)
    if (sec > 0) visit(readings[i], sec)
  }
}

/** Seconds spent in each of the 5 zones. Index 0 = Zone 1 … index 4 = Zone 5. Each inter-sample
 *  interval is attributed to the zone of the EARLIER reading, credited by `creditGap`. */
export function accumulateZoneSeconds(
  readings: readonly HrReading[],
  zones: HrZone[],
  options: GapOptions = {},
): number[] {
  const secs = [0, 0, 0, 0, 0]
  forEachCreditedInterval(readings, options, (r, sec) => {
    secs[zoneForBpm(r.bpm, zones).id - 1] += sec
  })
  return secs
}

/** Edwards TRIMP — the standard HR training-load number: minutes-in-zone × zone number (1..5),
 *  summed. This is "Session Load" (NOT "Training Stress (OTS)"). */
export function edwardsTrimp(zoneSeconds: number[]): number {
  return zoneSeconds.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0)
}

export interface ZoneSlice {
  id: HrZone['id']
  name: string
  color: string
  seconds: number
  pct: number
}
export interface ZoneBreakdown {
  zones: ZoneSlice[]
  totalSec: number
  sessionLoad: number
}

/** Full breakdown for a surface: per-zone seconds + %, total, and Session Load. */
export function zoneBreakdownFromReadings(
  readings: readonly HrReading[],
  zones: HrZone[],
  options: GapOptions = {},
): ZoneBreakdown {
  const secs = accumulateZoneSeconds(readings, zones, options)
  const totalSec = secs.reduce((a, b) => a + b, 0)
  return {
    zones: zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: z.color,
      seconds: secs[i],
      pct: totalSec > 0 ? (secs[i] / totalSec) * 100 : 0,
    })),
    totalSec,
    sessionLoad: Math.round(edwardsTrimp(secs)),
  }
}

/**
 * WHO active minutes computed from readings: moderate from `MODERATE_INTENSITY_FRAC` of reserve
 * (TN-78) counts once, vigorous from `VIGOROUS_INTENSITY_FRAC` (#2198) counts double.
 *
 * The zone map cannot answer this on its own: it is shared with run prescriptions, and its Zone 1
 * spans both "light" and the moderate band. So this walks the readings once, with the same gap rule
 * `accumulateZoneSeconds` uses (`creditGap`, window-aware since #3775), and splits on the two bpm edges `moderateIntensityBpm` and
 * `vigorousIntensityBpm` give for the profile.
 */
export function activeMinutesFromReadings(
  readings: readonly HrReading[],
  floors: { moderateFloorBpm: number; vigorousFloorBpm: number },
  options: GapOptions = {},
): number {
  const { moderateFloorBpm, vigorousFloorBpm } = floors
  let moderateSec = 0
  let vigorousSec = 0
  forEachCreditedInterval(readings, options, ({ bpm }, sec) => {
    if (bpm >= vigorousFloorBpm) vigorousSec += sec
    else if (bpm >= moderateFloorBpm) moderateSec += sec
  })
  return Math.round(moderateSec / 60 + (vigorousSec / 60) * 2)
}

/** WHO active minutes from per-zone seconds (index 0 = Zone 1), each zone weighted by
 *  `whoMinuteWeightForZone`: Zone 2 and above sit at or over the 60%-of-reserve vigorous line and
 *  count double (#2198); Zone 1 cannot be split at the moderate line and counts nothing. */
export function activeMinutesFromZoneSeconds(zoneSeconds: number[]): number {
  const min = zoneSeconds.reduce((sum, sec, i) => sum + (sec / 60) * whoMinuteWeightForZone((i + 1) as HrZone['id']), 0)
  return Math.round(min)
}

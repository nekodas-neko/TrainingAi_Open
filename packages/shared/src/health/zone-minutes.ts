// The single shared "time-in-HR-zone" primitive — zone-second accumulation + Edwards-TRIMP
// "Session Load". Both the per-workout zone breakdown and the day/week/month time-in-zone stats
// import from here (One Formula, One Place). Zones come only from `hr-zones.ts`; never re-band here.
// "Session Load" is the per-workout HR number — distinct from whole-day "Training Stress (OTS)".
import { zoneForBpm, whoMinuteWeightForZone, type HrZone } from './hr-zones'

export interface HrReading {
  /** epoch ms */
  timestamp: number
  bpm: number
}

/** Default cap for the gap between two consecutive readings (seconds). A ring samples ~1/min; a
 *  strap faster. Anything longer than this is a data gap (ring asleep, no wear) and must not inflate
 *  a zone — cap it. */
export const DEFAULT_MAX_GAP_SEC = 120

/** Seconds spent in each of the 5 zones. Index 0 = Zone 1 … index 4 = Zone 5. Each inter-sample
 *  interval is attributed to the zone of the EARLIER reading, capped at maxGapSec. */
export function accumulateZoneSeconds(
  readings: HrReading[],
  zones: HrZone[],
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): number[] {
  const secs = [0, 0, 0, 0, 0]
  for (let i = 0; i < readings.length - 1; i++) {
    const dt = Math.min((readings[i + 1].timestamp - readings[i].timestamp) / 1000, maxGapSec)
    if (dt <= 0) continue
    const z = zoneForBpm(readings[i].bpm, zones)
    secs[z.id - 1] += dt
  }
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
  readings: HrReading[],
  zones: HrZone[],
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): ZoneBreakdown {
  const secs = accumulateZoneSeconds(readings, zones, maxGapSec)
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
 * spans both "light" and the moderate band. So this walks the readings once, with the same gap cap
 * `accumulateZoneSeconds` uses, and splits on the two bpm edges `moderateIntensityBpm` and
 * `vigorousIntensityBpm` give for the profile.
 */
export function activeMinutesFromReadings(
  readings: HrReading[],
  floors: { moderateFloorBpm: number; vigorousFloorBpm: number },
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): number {
  const { moderateFloorBpm, vigorousFloorBpm } = floors
  let moderateSec = 0
  let vigorousSec = 0
  for (let i = 0; i + 1 < readings.length; i++) {
    const dt = Math.min((readings[i + 1].timestamp - readings[i].timestamp) / 1000, maxGapSec)
    const bpm = readings[i].bpm
    if (bpm >= vigorousFloorBpm) vigorousSec += dt
    else if (bpm >= moderateFloorBpm) moderateSec += dt
  }
  return Math.round(moderateSec / 60 + (vigorousSec / 60) * 2)
}

/** WHO active minutes from per-zone seconds (index 0 = Zone 1), each zone weighted by
 *  `whoMinuteWeightForZone`: Zone 2 and above sit at or over the 60%-of-reserve vigorous line and
 *  count double (#2198); Zone 1 cannot be split at the moderate line and counts nothing. */
export function activeMinutesFromZoneSeconds(zoneSeconds: number[]): number {
  const min = zoneSeconds.reduce((sum, sec, i) => sum + (sec / 60) * whoMinuteWeightForZone((i + 1) as HrZone['id']), 0)
  return Math.round(min)
}

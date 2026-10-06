// lib/health/hr-window-merge.ts
// Merge precedence for HR time-series reads. `oura_heartrate` is shared by every HR source, so
// which rows a score reads is decided here, at read time, and every source's rows stay stored
// (ingest architecture D2: rank picks the winner per interval, the loser is kept).
//
// Two rules, applied in order by `mergeHrSources`:
//  1. A platform-aggregator row (Health Connect, Apple Health) yields to any device row within
//     `AGGREGATOR_COVER_MS` of it.
//  2. Where the chest strap (1 Hz, beat-accurate) and the ring (5-min binned) both cover a 10 s
//     bucket, the strap's rows win and the ring's are dropped. Buckets with only one source pass
//     through untouched — the strap never thins its own dense stream.
import { HEALTH_SOURCES, SOURCE_RANK } from './source-rank'

export interface HrRow { timestamp: Date; bpm: number; source: string | null }

const BUCKET_MS = 10_000

export function preferStrapBuckets(rows: HrRow[]): HrRow[] {
  const strapBuckets = new Set<number>()
  for (const r of rows) {
    if (r.source === 'chest_strap') strapBuckets.add(Math.floor(r.timestamp.getTime() / BUCKET_MS))
  }
  return rows
    .filter(r => r.source === 'chest_strap' || !strapBuckets.has(Math.floor(r.timestamp.getTime() / BUCKET_MS)))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

/**
 * The sources that rank at the bottom of the health-source ladder — Health Connect and Apple
 * Health. Derived from `SOURCE_RANK` rather than listed, so the HR table and the per-field merge
 * cannot disagree about who is the aggregator tier.
 *
 * Every other value `oura_heartrate.source` holds is a device the app reads itself: `ble` (the
 * ring, `oura_ble` on the ladder), `chest_strap`, and the retired Oura Cloud feed's tiers. A NULL
 * source is a pre-provenance ring row — no aggregator wrote this table before #2168 — so it counts
 * as a device row here, not as the ladder's rank-0 "unknown".
 */
export const AGGREGATOR_HR_SOURCES: readonly string[] = HEALTH_SOURCES
  .filter(s => SOURCE_RANK[s] <= SOURCE_RANK.health_connect)

export function isAggregatorHrSource(source: string | null): boolean {
  return source != null && AGGREGATOR_HR_SOURCES.includes(source)
}

/**
 * How near a device row has to be for an aggregator row to yield to it, either side, inclusive.
 * Five minutes is the ring's native series bin (`HR_SERIES_BIN_DS` in the rollup): a ring row
 * stands for the five minutes after its timestamp, so anything closer than that is the same
 * interval. Symmetric on purpose — a ring bin's timestamp is aligned to the ring's own clock, not
 * the wall clock, and erring wide keeps a device-covered day reading the device alone.
 */
export const AGGREGATOR_COVER_MS = 5 * 60_000

/** Drop every aggregator row that has a device row within `AGGREGATOR_COVER_MS`. Device rows and
 *  uncovered aggregator rows pass through in their original order. */
export function yieldAggregatorToDevice(rows: HrRow[]): HrRow[] {
  const deviceTimes = rows
    .filter(r => !isAggregatorHrSource(r.source))
    .map(r => r.timestamp.getTime())
    .sort((a, b) => a - b)
  if (deviceTimes.length === 0) return rows
  return rows.filter(r => {
    if (!isAggregatorHrSource(r.source)) return true
    const t = r.timestamp.getTime()
    // First device row at or after the start of this row's cover window.
    let lo = 0
    let hi = deviceTimes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (deviceTimes[mid] < t - AGGREGATOR_COVER_MS) lo = mid + 1
      else hi = mid
    }
    return !(lo < deviceTimes.length && deviceTimes[lo] <= t + AGGREGATOR_COVER_MS)
  })
}

/** The rows a score reads from one window of `oura_heartrate`, sorted by timestamp. Both rules
 *  build their coverage from the rows in that window only. */
export function mergeHrSources(rows: HrRow[]): HrRow[] {
  return preferStrapBuckets(yieldAggregatorToDevice(rows))
}

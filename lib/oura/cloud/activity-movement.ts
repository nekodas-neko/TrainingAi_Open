// #3597: the Oura Cloud connector's mapping from its stored activity fields to the generic
// per-minute movement series (`MovementIntervalSeries`, `per-minute-movement.ts`). Scoring reads
// only the generic shape; a Fitbit or Health Connect adapter would write its own mapping beside its
// own connector.
//
// The series is `daily_activity.met` as the connector stored it (`oura_cloud_daily.met`), taken as
// Oura calculated it (owner, 2026-10-18, #2860): `interval` seconds per item from `timestamp`.
// `class_5_min` is the same document's 5-minute activity class from the same start, and `0` is
// non-wear. Oura's activity day starts at 4 a.m. local; the grid places each item by its own instant.
import type { MovementIntervalSeries } from '@trainingai/shared/health/per-minute-movement'
import { OURA_CLOUD_CONNECTOR } from '@trainingai/shared/health/source-connectors'

const CLASS_SLOT_MS = 5 * 60_000
const NON_WEAR = '0'

/** One `oura_cloud_daily` row's activity fields. */
export interface OuraActivitySeriesDay {
  met: { interval: number; items: readonly (number | null)[]; timestamp: string } | null
  class5Min: string | null
}

/** Each day's MET series with its non-wear slots. A day without a usable series supplies nothing,
 *  its wear class included (the class string is positioned by the series' own start). */
export function ouraActivityMovementSeries(days: readonly OuraActivitySeriesDay[]): MovementIntervalSeries[] {
  const out: MovementIntervalSeries[] = []
  for (const day of days) {
    const met = day.met
    if (!met) continue
    const startMs = Date.parse(met.timestamp)
    const intervalMs = met.interval * 1000
    if (!Number.isFinite(startMs) || !(intervalMs > 0)) continue
    const notWorn: { startMs: number; endMs: number }[] = []
    const classes = day.class5Min ?? ''
    for (let j = 0; j < classes.length; j++) {
      if (classes[j] !== NON_WEAR) continue
      const a = startMs + j * CLASS_SLOT_MS
      notWorn.push({ startMs: a, endMs: a + CLASS_SLOT_MS })
    }
    out.push({ source: OURA_CLOUD_CONNECTOR.healthSource, startMs, intervalMs, mets: met.items, notWorn })
  }
  return out
}

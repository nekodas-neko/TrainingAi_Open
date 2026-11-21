// Recent-3-nights-versus-older-baseline trends of the night's HRV and blood oxygen, from the generic
// `BodyMetrics` shape (`hrvMs`/`hrvSource`, `spo2Pct`/`spo2Source`) any connector maps. THE only
// implementation: the AI prescription signals (`signals.ts`) and the daily check's inputs
// (`getNextSession` in the Postgres adapter) both call these, so the rest-day rule the prompt states
// and the one the daily check applies (#3718) read the same numbers. The adapter's own inline copy of
// the HRV trend had drifted from this one (it kept low-wear days in the baseline).
import type { BodyMetrics } from '@trainingai/shared/types/body'
import { rowsOfDeviceInUse, nightAlgorithmVersion } from './per-device-normal'
import { excludeLowWearDays, type WearByDate } from './wear-confidence'
import type { TrendReading } from './sleep-trend'

type Night = Parameters<typeof nightAlgorithmVersion>[0][number]

function trendOf(
  rows: readonly BodyMetrics[],
  nights: readonly Night[],
  value: (m: BodyMetrics) => number | null | undefined,
  source: (m: BodyMetrics) => string | null | undefined,
  olderFilter: (older: BodyMetrics[]) => BodyMetrics[],
): TrendReading | null {
  const versionOn = nightAlgorithmVersion(nights)
  // #3001/#3383: both stretches from the device in use, so one device's nights are never compared
  // with another's. #3601: and from its newest algorithm version, read from the same night's sleep.
  const usable = rowsOfDeviceInUse(rows.filter(m => { const v = value(m); return v != null && v > 0 }), value, source, m => versionOn(m.date, source(m)))
  if (usable.length < 4) return null
  const sorted = [...usable].sort((a, b) => b.date.localeCompare(a.date))
  const recent3 = sorted.slice(0, 3)
  const older = olderFilter(sorted.slice(3)).slice(0, 7)
  if (older.length === 0) return null
  const recentAvg = recent3.reduce((s, m) => s + value(m)!, 0) / recent3.length
  const olderAvg = older.reduce((s, m) => s + value(m)!, 0) / older.length
  return olderAvg > 0 ? { ratio: recentAvg / olderAvg, newestDate: recent3[0].date } : null
}

/**
 * HRV trend. The older baseline leaves out low-wear days (the filter readiness's HRV/RHR baselines
 * use): an unworn ring's HRV should not anchor what normal looks like. The recent 3 are unfiltered,
 * since they are the current state. Null under four nights from the device in use.
 */
export function hrvTrendReading(rows: readonly BodyMetrics[], nights: readonly Night[], wear: WearByDate): TrendReading | null {
  return trendOf(rows, nights, m => m.hrvMs, m => m.hrvSource, older => excludeLowWearDays(older, wear))
}

/** Blood-oxygen trend, the same comparison. Null for a user whose devices send no blood oxygen. */
export function spo2TrendReading(rows: readonly BodyMetrics[], nights: readonly Night[]): TrendReading | null {
  return trendOf(rows, nights, m => m.spo2Pct, m => m.spo2Source, older => older)
}

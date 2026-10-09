/**
 * The per-day daytime-stress series, in one place.
 *
 * Two callers need the same series: the rollup's resilience step (the forward writer, which persists
 * it into `oura_daytime_stress_buckets` for the trailing days) and the stress-bucket backfill (issue
 * 2236, which adds the days the forward writer never reached). Two copies of this assembly would be
 * two definitions of one metric, so both call the functions below. The model, the bucketing and the
 * scoring stay where they were (`buildDaytimeStressSeriesFromModel`); this only owns how a day's
 * inputs are gathered and which baselines it is scored against.
 *
 * Runtime-agnostic and write-free: it takes decoded rows and returns points.
 */
import { buildDaytimeStressSeriesFromModel, type DhrvBaselines, type StressPoint } from '@/lib/health/daytime-stress'
import { numericField as numArr } from '@trainingai/shared/health/night-vitals'
import type { DaytimeHrvModel } from '@trainingai/shared/health/daytime-hrv-model'

/** Raw-frame tags the stress series reads, by role. The rollup reads these (and more) in one query;
 *  the backfill reads only these. */
export const STRESS_SERIES_TAGS = {
  /** temperature frames (daytime) */
  temp: [0x46, 0x69],
  /** sleep temperature frames; the series also reads these, as the rollup always has */
  sleepTemp: [0x75],
  /** MET (activity) frames */
  met: [0x50],
  /** inter-beat-interval frames carrying hr_bpm */
  ibi: [0x80, 0x60],
  /** always-on heart-rate frames */
  aohr: [0x86],
} as const

export const ALL_STRESS_SERIES_TAGS: readonly number[] = [
  ...STRESS_SERIES_TAGS.temp, ...STRESS_SERIES_TAGS.sleepTemp, ...STRESS_SERIES_TAGS.met,
  ...STRESS_SERIES_TAGS.ibi, ...STRESS_SERIES_TAGS.aohr,
]

export interface StressSeriesInputs {
  temp: { tsMs: number; valueC: number }[]
  met: { tsMs: number; value: number }[]
  hr: { tsMs: number; bpm: number }[]
}

/**
 * Gather the three input series from decoded frames. Frames whose tag the series does not read are
 * ignored, so the rollup can hand over its whole decoded set. `toMs` is the caller's ds→wall-clock
 * conversion (clock anchors), so the same frame lands on the same instant in both callers.
 * Each series comes back ascending by time.
 */
export function collectStressInputs(
  rows: readonly { ds: number; tag: number; decoded: Record<string, unknown> | null }[],
  toMs: (ds: number) => number,
): StressSeriesInputs {
  const temp: StressSeriesInputs['temp'] = []
  const met: StressSeriesInputs['met'] = []
  const hr: StressSeriesInputs['hr'] = []
  const tempTags = new Set<number>([...STRESS_SERIES_TAGS.temp, ...STRESS_SERIES_TAGS.sleepTemp])
  const metTags = new Set<number>(STRESS_SERIES_TAGS.met)
  const ibiTags = new Set<number>(STRESS_SERIES_TAGS.ibi)
  const aohrTags = new Set<number>(STRESS_SERIES_TAGS.aohr)
  for (const r of rows) {
    if (r.decoded == null) continue
    if (tempTags.has(r.tag)) {
      const t = toMs(Number(r.ds))
      if (!Number.isFinite(t)) continue
      for (const valueC of numArr(r.decoded, 'temps_c')) temp.push({ tsMs: t, valueC })
    } else if (metTags.has(r.tag)) {
      const t = toMs(Number(r.ds))
      if (!Number.isFinite(t)) continue
      for (const value of numArr(r.decoded, 'met')) met.push({ tsMs: t, value })
    } else if (ibiTags.has(r.tag)) {
      const t = toMs(Number(r.ds))
      if (!Number.isFinite(t)) continue
      for (const bpm of numArr(r.decoded, 'hr_bpm')) hr.push({ tsMs: t, bpm })
    } else if (aohrTags.has(r.tag)) {
      const t = toMs(Number(r.ds))
      if (!Number.isFinite(t)) continue
      for (const bpm of numArr(r.decoded, 'bpm')) hr.push({ tsMs: t, bpm })
    }
  }
  const byTime = (a: { tsMs: number }, b: { tsMs: number }) => a.tsMs - b.tsMs
  return {
    temp: temp.sort(byTime),
    met: met.sort(byTime),
    hr: hr.filter(h => h.bpm >= 35 && h.bpm <= 200).sort(byTime),
  }
}

/** First index in an ascending series whose time is >= `ms`. */
function lowerBound(series: readonly { tsMs: number }[], ms: number): number {
  let lo = 0
  let hi = series.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (series[mid].tsMs < ms) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The slice of an ascending series inside `[fromMs, toMs)`. */
export function sliceWindow<T extends { tsMs: number }>(series: readonly T[], fromMs: number, toMs: number): T[] {
  return series.slice(lowerBound(series, fromMs), lowerBound(series, toMs))
}

/**
 * Night HRV baseline (ms) for a day: the smoothed personal baseline (stored x8 fixed-point), else
 * the night's own average as a cold-start proxy. Doubles as the daytime-stress scaling anchor.
 */
export function nightHrvMsOf(
  row: { hrvBaseline: { meanX8: number } | null; hrvAvgMs: number | null },
): number | null {
  return row.hrvBaseline != null ? row.hrvBaseline.meanX8 / 8 : row.hrvAvgMs
}

export type StressSeriesSkipReason =
  | 'no-daytime-hrv-model'
  | 'no-night-hrv-baseline'
  | 'no-resting-heart-rate'
  | 'no-temperature-in-day'
  | 'no-scorable-buckets'

export interface DayStressSeriesInput {
  dayStartMs: number
  dayEndMs: number
  inputs: StressSeriesInputs
  model: DaytimeHrvModel | null
  /** the night HRV baseline (ms): the smoothed personal baseline, else the night's own average */
  nightHrvMs: number | null | undefined
  /** the night's lowest resting heart rate (bpm) */
  rhrLowBpm: number | null | undefined
  /** sleep windows that can touch the day, as `{ sleepStart, sleepEnd }` */
  sleepWindows: { sleepStart: Date; sleepEnd: Date }[]
}

export type DayStressSeries =
  | { points: StressPoint[]; skipped: null; tempBaseline: number }
  | { points: []; skipped: StressSeriesSkipReason; tempBaseline: number | null }

/**
 * One local day's 30-minute stress series, or the reason it cannot be built. The reason matters to
 * the backfill, which reports it instead of guessing; the rollup ignores it and treats a skip as an
 * empty series, exactly as it always has.
 *
 * Baselines: night HRV from `nightHrvMs`, resting HR from `rhrLowBpm`, skin temperature from the
 * day's own mean. Sleep windows are dropped before scoring (LA-112); the caller passes every window
 * overlapping the day, the night that ended this morning and the one that starts tonight.
 */
export function buildDayStressSeries(inp: DayStressSeriesInput): DayStressSeries {
  const { dayStartMs, dayEndMs, inputs, model, nightHrvMs, rhrLowBpm } = inp
  const dayTemp = sliceWindow(inputs.temp, dayStartMs, dayEndMs)
  const tempBaseline = dayTemp.length ? dayTemp.reduce((s, t) => s + t.valueC, 0) / dayTemp.length : null
  if (!model) return { points: [], skipped: 'no-daytime-hrv-model', tempBaseline }
  if (nightHrvMs == null || !(nightHrvMs > 0)) return { points: [], skipped: 'no-night-hrv-baseline', tempBaseline }
  if (rhrLowBpm == null || !(rhrLowBpm > 0)) return { points: [], skipped: 'no-resting-heart-rate', tempBaseline }
  if (tempBaseline == null || !(tempBaseline > 0)) return { points: [], skipped: 'no-temperature-in-day', tempBaseline }
  const baselines: DhrvBaselines = { dhrvBaseline: nightHrvMs, hrBaseline: rhrLowBpm, tempBaseline }
  const points = buildDaytimeStressSeriesFromModel(
    dayTemp,
    sliceWindow(inputs.met, dayStartMs, dayEndMs),
    sliceWindow(inputs.hr, dayStartMs, dayEndMs),
    model, baselines, dayStartMs, dayEndMs,
    inp.sleepWindows.filter(w => w.sleepEnd.getTime() > dayStartMs && w.sleepStart.getTime() < dayEndMs),
  )
  if (points.length === 0) return { points: [], skipped: 'no-scorable-buckets', tempBaseline }
  return { points, skipped: null, tempBaseline }
}

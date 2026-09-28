/**
 * TN-56 — scoring functions an admin can re-run over a date range with one constant bracketed.
 *
 * Tuning's thresholds whose inputs are per-sample intermediates (never persisted) cannot be judged
 * from stored data: only re-running the pipeline shows what a different value would have produced.
 * This is that, and deliberately NOT a general "run code" endpoint: a caller names a function below
 * and a bracket for one of ITS parameters, and nothing else is reachable.
 *
 * Each function LOADS its inputs once (the database work) and EVALUATES purely per bracket value,
 * so a ten-value bracket costs one load. Nothing here writes: a replay that persisted would be a
 * history rewrite, which is a separate owner decision every time.
 *
 * **Adding a function** means making its constants overridable where they live (an optional options
 * argument whose defaults are the shipped constants, so the production caller is unchanged), then
 * registering it here. Each entry reports the value the pipeline stored beside the replayed one,
 * so running the defaults is a self-check that the replay reproduces production.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { decodeEventBody, hexToBytes } from '@/lib/oura-ble/decode'
import { resolveMsToDs } from '@/lib/oura-ble/clock'
import { nightlyTemperatureCentiC, temperatureFrameSeries, RANGE_THRESHOLD, MIN_WINDOWS } from '@trainingai/shared/health/temperature-baseline'
import { numericField } from '@trainingai/shared/health/night-vitals'
import { canonicalNightForDate } from '@trainingai/shared/health/sleep-night'

export interface ReplayParam {
  name: string
  description: string
  default: number
  min: number
  max: number
}

export interface ReplayContext {
  userId: string
  from: string
  to: string
  repo: WorkoutRepository
}

export interface ReplayDay {
  date: string
  /** What the function produces with the bracketed value. */
  value: number | null
  /** What production stored for the day, for comparison. */
  stored: number | null
}

export interface ReplayFunction<Inputs = unknown> {
  name: string
  description: string
  unit: string
  params: ReplayParam[]
  load(ctx: ReplayContext): Promise<Inputs>
  evaluate(inputs: Inputs, params: Record<string, number>): ReplayDay[]
}

// ── nightly-temperature ──────────────────────────────────────────────────────────────────────────

const SLEEP_TEMP_TAG = 0x75

interface NightInputs {
  nights: { date: string; samples: number[]; stored: number | null }[]
}

/** The rollup's nightly skin temperature (open_oura port), from each date's main night's 0x75
 *  frames between the stored sleep start and end. Same frames, same collapse, same algorithm. */
const nightlyTemperature: ReplayFunction<NightInputs> = {
  name: 'nightly-temperature',
  description: "Nightly skin temperature from the main night's sleep_temp frames (temperature-baseline.ts).",
  unit: '°C',
  params: [
    { name: 'RANGE_THRESHOLD', description: 'Max in-window range, centi-°C, for a 30-sample window to count', default: RANGE_THRESHOLD, min: 10, max: 2000 },
    { name: 'MIN_WINDOWS', description: 'Valid windows needed before a night gets a value', default: MIN_WINDOWS, min: 1, max: 40 },
  ],
  async load({ userId, from, to, repo }) {
    const [sessions, anchors, summaries] = await Promise.all([
      repo.listSleepSessions(userId, from, to),
      repo.getOuraClockAnchors(userId),
      repo.getOuraDailySummary(userId, from, to),
    ])
    const storedByDate = new Map(summaries.map(s => [s.date, s.tempMeanC]))
    const dates = [...new Set(sessions.map(s => s.date))].sort()
    const nights: NightInputs['nights'] = []
    for (const date of dates) {
      const night = canonicalNightForDate(sessions, date)
      if (!night) continue
      const startDs = resolveMsToDs(new Date(night.sleepStart).getTime(), anchors)
      const endDs = resolveMsToDs(new Date(night.sleepEnd).getTime(), anchors)
      if (startDs == null || endDs == null) {
        nights.push({ date, samples: [], stored: storedByDate.get(date) ?? null })
        continue
      }
      const frames = await repo.readOuraRawFrames(userId, { tags: [SLEEP_TEMP_TAG], startDs: Math.floor(startDs), endDs: Math.ceil(endDs) })
      const series = temperatureFrameSeries(frames.map(r => ({
        ds: Number(r.ds),
        tempsC: numericField(r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null), 'temps_c'),
      })))
      nights.push({ date, samples: series.map(t => t.centi), stored: storedByDate.get(date) ?? null })
    }
    return { nights }
  },
  evaluate({ nights }, p) {
    return nights.map(n => {
      const centi = n.samples.length > 0
        ? nightlyTemperatureCentiC(n.samples, { rangeThresholdCenti: p.RANGE_THRESHOLD, minWindows: p.MIN_WINDOWS })
        : null
      return { date: n.date, value: centi != null ? centi / 100 : null, stored: n.stored }
    })
  },
}

export const REPLAY_FUNCTIONS: Record<string, ReplayFunction<never>> = {
  [nightlyTemperature.name]: nightlyTemperature as ReplayFunction<never>,
}

export interface ReplaySummary { n: number; nulls: number; min: number | null; p10: number | null; p50: number | null; p90: number | null; max: number | null; matchesStored: number }

const q = (sorted: number[], f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1) + 0.5))] : null)

/** The distribution the caller compares across brackets. `matchesStored` counts days whose value
 *  equals what production stored (to 0.01), which at the defaults is the replay's self-check. */
export function summarise(days: ReplayDay[]): ReplaySummary {
  const vals = days.map(d => d.value).filter((v): v is number => v != null).sort((a, b) => a - b)
  return {
    n: days.length,
    nulls: days.length - vals.length,
    min: vals[0] ?? null,
    p10: q(vals, 0.1),
    p50: q(vals, 0.5),
    p90: q(vals, 0.9),
    max: vals[vals.length - 1] ?? null,
    matchesStored: days.filter(d => d.value != null && d.stored != null && Math.abs(d.value - d.stored) < 0.01).length,
  }
}

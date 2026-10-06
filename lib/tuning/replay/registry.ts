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
import { resolveMsToDs, resolveDsToMs } from '@/lib/oura-ble/clock'
import { nightlyTemperatureCentiC, temperatureFrameSeries, RANGE_THRESHOLD, MIN_WINDOWS } from '@trainingai/shared/health/temperature-baseline'
import { numericField } from '@trainingai/shared/health/night-vitals'
import { dateStrMidnightInTz, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
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
  /** The user's own zone, for anything that assigns an instant to a local day. */
  timezone: string
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

/** A gap this long between two sleep_temp frames ends one sleep block and starts the next. */
const BLOCK_GAP_DS = 2 * 3600 * 10
/** Four 30-sample windows: fewer frames than this cannot produce a nightly value at the defaults. */
const MIN_NIGHT_SAMPLES = 120

/**
 * The rollup's nightly skin temperature (open_oura port), replayed from the night's own sleep_temp
 * (0x75) frames, with the same collapse and the same algorithm.
 *
 * **Which frames make a night, measured on real data (2026-09-01 → 09-27):**
 * - The stored `sleep_sessions` window reproduces production EXACTLY (11 of 11) where it is the
 *   night, because it is the rollup's own trimmed window. But for 7 dates it holds only a daytime
 *   nap (the night the rollup scored is not kept there; the LA-144 shape), so it scores nothing.
 * - Clustering the 0x75 frames themselves (0x75 fires only while asleep; a 2 h gap ends a block;
 *   a day's largest block, by the local day it ends on, is its night) finds every night, but
 *   without the rollup's trimming it lands a few hundredths off on several.
 * So: the stored window when it holds enough frames to score a night, else the cluster. The
 * `matchesStored` count in every response says how many days reproduced exactly.
 */
const nightlyTemperature: ReplayFunction<NightInputs> = {
  name: 'nightly-temperature',
  description: "Nightly skin temperature from each day's main sleep block of sleep_temp frames (temperature-baseline.ts).",
  unit: '°C',
  params: [
    { name: 'RANGE_THRESHOLD', description: 'Max in-window range, centi-°C, for a 30-sample window to count', default: RANGE_THRESHOLD, min: 10, max: 2000 },
    { name: 'MIN_WINDOWS', description: 'Valid windows needed before a night gets a value', default: MIN_WINDOWS, min: 1, max: 40 },
  ],
  async load({ userId, timezone, from, to, repo }) {
    const [anchors, summaries, sessions] = await Promise.all([
      repo.getOuraClockAnchors(userId),
      repo.getOuraDailySummary(userId, from, to),
      repo.listSleepSessions(userId, from, to),
    ])
    const storedByDate = new Map(summaries.map(s => [s.date, s.tempMeanC]))
    const dates: string[] = []
    for (let d = from; d <= to; d = shiftDateStr(d, 1)) dates.push(d)

    // A night that ends on `from` starts the evening before, so read from a day earlier.
    const startDs = resolveMsToDs(dateStrMidnightInTz(shiftDateStr(from, -1), timezone).getTime(), anchors)
    const endDs = resolveMsToDs(dateStrMidnightInTz(shiftDateStr(to, 1), timezone).getTime(), anchors)
    const byDate = new Map<string, number[]>()
    const toCenti = (rows: { ds: unknown; tag: number; bodyHex: string; decoded: Record<string, unknown> | null }[]) =>
      temperatureFrameSeries(rows.map(r => ({
        ds: Number(r.ds),
        tempsC: numericField(r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null), 'temps_c'),
      }))).map(t => t.centi)
    if (startDs != null && endDs != null) {
      const frames = (await repo.readOuraRawFrames(userId, { tags: [SLEEP_TEMP_TAG], startDs: Math.floor(startDs), endDs: Math.ceil(endDs) }))
        .sort((x, y) => Number(x.ds) - Number(y.ds))
      let block: typeof frames = []
      const close = () => {
        if (block.length === 0) return
        const endMs = resolveDsToMs(Number(block[block.length - 1].ds), anchors)
        if (endMs != null) {
          const day = toAestDay(new Date(endMs), timezone)
          const centi = toCenti(block)
          if (centi.length > (byDate.get(day)?.length ?? 0)) byDate.set(day, centi)
        }
        block = []
      }
      for (const f of frames) {
        if (block.length > 0 && Number(f.ds) - Number(block[block.length - 1].ds) > BLOCK_GAP_DS) close()
        block.push(f)
      }
      close()

      // Prefer the stored window where it is the night: it is the rollup's own trimmed window.
      for (const date of dates) {
        const night = canonicalNightForDate(sessions, date, timezone)
        if (!night) continue
        const a = resolveMsToDs(new Date(night.sleepStart).getTime(), anchors)
        const b = resolveMsToDs(new Date(night.sleepEnd).getTime(), anchors)
        if (a == null || b == null) continue
        const centi = toCenti(frames.filter(f => Number(f.ds) >= a && Number(f.ds) <= b))
        if (centi.length >= MIN_NIGHT_SAMPLES) byDate.set(date, centi)
      }
    }
    return { nights: dates.map(date => ({ date, samples: byDate.get(date) ?? [], stored: storedByDate.get(date) ?? null })) }
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

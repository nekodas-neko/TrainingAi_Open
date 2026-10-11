/**
 * `MET/min` for one day, resolved through the input cascade (#2115 v4, owner 2026-10-06), for the
 * training-load model. The scorer reads the result and never learns which device filled a minute.
 *
 * Each minute takes the best route that has it (`INPUTS['MET/min']` in `inputs/cascade.ts`):
 *   1  the ring's own MET                            `metGridCandidates`
 *   1b a device's active calories with your weight   `activeKcalMetCandidates`
 *   2a the ring's daytime motion                     not built: no fitted map yet (see below)
 *   2b the ring's sleep-motion marker → 1.0          `ringStillMetCandidates`
 *   2c step cadence                                  `cadenceMetCandidates`
 *   2d a sleep record from any device → 1.0          `sleepSessionMetCandidates`
 *   3  a logged workout's Compendium MET             `compendiumMetCandidates`
 * A minute none of them fills is `null`: missing, never zero and never rest. What the model does with
 * those is `fillOtsGaps`' business.
 *
 * Rung 2a (the `0x47` motion map) needs a lookup table fitted on paired minutes of real data; no table
 * ships yet, so the route has no candidates and its minutes fall to the rungs below it. Rungs 1b and
 * 2c need a per-minute Health Connect ingest that is its own migration batch; until it lands their
 * inputs are empty.
 */
import { coverage, resolveMinutes, type Resolved } from '@trainingai/shared/inputs/cascade'
import {
  metGridCandidates, activeKcalMetCandidates, cadenceMetCandidates, ringStillMetCandidates,
  sleepSessionMetCandidates, compendiumMetCandidates,
} from '@trainingai/shared/inputs/adapters'
import type { MetMix } from '@trainingai/shared/health/training-stress'

export interface DayMetSources {
  /** The ring's 1-minute MET grid (`metGridFromDaytimeSamples`). */
  ringGrid: { startTimestampMs: number; metsPerMinute: readonly (number | null)[] }
  /** Wall-clock instants of the ring's `0x72` sleep-motion frames. */
  ringStillFramesMs: readonly number[]
  /** Sleep records from any source. */
  sleepSessions: readonly { startMs: number; endMs: number; source: string }[]
  /** Logged activities with their Compendium MET (`metForActivity`), null when unknown. */
  activities: readonly { startMs: number; endMs: number; met: number | null; source?: string }[]
  /** Active-calorie records from sources that provide them, and the weight to convert them with. */
  activeKcal?: readonly { startMs: number; endMs: number; kcal: number; source: string }[]
  weightKg?: number | null
  /** A resolved `steps/min` series, for the cadence route. */
  stepsPerMinute?: readonly Resolved[]
}

/** Resolve `[fromMs, toMs)` minute by minute. `metsPerMinute[i]` is the minute `fromMs + i·60 s`. */
export function resolveDayMetPerMinute(
  src: DayMetSources, fromMs: number, toMs: number,
): { startTimestampMs: number; metsPerMinute: (number | null)[]; mix: MetMix; series: Resolved[] } {
  const series = resolveMinutes('MET/min', [
    ...metGridCandidates(src.ringGrid, 'oura_ble'),
    ...activeKcalMetCandidates(src.activeKcal ?? [], src.weightKg ?? null),
    ...ringStillMetCandidates(src.ringStillFramesMs, 'oura_ble'),
    ...cadenceMetCandidates(src.stepsPerMinute ?? []),
    ...sleepSessionMetCandidates(src.sleepSessions),
    ...compendiumMetCandidates(src.activities),
  ], fromMs, toMs)
  const cov = coverage(series)
  return {
    startTimestampMs: series[0]?.slot as number ?? fromMs,
    metsPerMinute: series.map(r => r.value),
    mix: { ...cov.byRung, missing: cov.missing },
    series,
  }
}

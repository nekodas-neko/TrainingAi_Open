/**
 * `MET/min` for one day, resolved through the input cascade (#2115 v4, owner 2026-10-06), for the
 * training-load model. The scorer reads the result and never learns which device filled a minute.
 *
 * Each minute takes the best route that has it (`INPUTS['MET/min']` in `inputs/cascade.ts`):
 *   1  the ring's own MET, then Oura's MET series      `metGridCandidates`
 *   1b a device's active calories with your weight   `activeKcalMetCandidates`
 *   2a the ring's motion (`0x47`), default map       `ringMotionMetCandidates`
 *   2b the ring's sleep-motion marker → 1.0          `ringStillMetCandidates`
 *   2c step cadence                                  `cadenceMetCandidates`
 *   2d a sleep record from any device → 1.0          `sleepSessionMetCandidates`
 *   3  a logged workout's Compendium MET             `compendiumMetCandidates`
 * A minute none of them fills is `null`: missing, never zero and never rest. What the model does with
 * those is `fillOtsGaps`' business.
 *
 * Within rung 1 the ring's minute is offered first, so it wins wherever it exists; Oura's series
 * (`ouraCloudMetGrid`, #2985) fills the rest, which after the switch to the Oura API is every minute.
 *
 * Rung 2a reads the default map fitted on the owner (`RING_MOTION_MET_MAP_V1`, #2781); a personal map
 * from a user's own paired minutes is a follow-up. Rungs 1b and 2c read Health Connect's per-interval
 * calories and steps (#2462); without them their inputs are empty.
 */
import { coverage, minuteOf, resolveMinutes, type Resolved } from '@trainingai/shared/inputs/cascade'
import {
  metGridCandidates, activeKcalMetCandidates, ringMotionMetCandidates, cadenceMetCandidates, ringStillMetCandidates,
  sleepSessionMetCandidates, compendiumMetCandidates,
} from '@trainingai/shared/inputs/adapters'
import type { MetMix } from './met-mix'

type MetGrid = { startTimestampMs: number; metsPerMinute: readonly (number | null)[] }

export interface DayMetSources {
  /** The ring's 1-minute MET grid (`metGridFromDaytimeSamples`). */
  ringGrid: MetGrid
  /** Oura's MET series as a grid, wear-gated (`ouraCloudMetGrid`). */
  cloudGrid?: MetGrid
  /** The ring's `0x47` motion events with their low-intensity values (#2781). */
  ringMotion?: readonly { tsMs: number; lowIntensity: number }[]
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
    ...metGridCandidates(src.cloudGrid ?? EMPTY_GRID, 'oura_cloud'),
    ...activeKcalMetCandidates(src.activeKcal ?? [], src.weightKg ?? null),
    ...ringMotionMetCandidates(src.ringMotion ?? [], 'oura_ble'),
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

const EMPTY_GRID: MetGrid = { startTimestampMs: 0, metsPerMinute: [] }

/**
 * Rung 1 alone over `[fromMs, toMs)`: the ring's MET where it has a minute, Oura's elsewhere. For a
 * reader that wants a device's MET and nothing estimated, which is walk detection (#2471).
 */
export function deviceMetGrid(ringGrid: MetGrid, cloudGrid: MetGrid, fromMs: number, toMs: number): { startTimestampMs: number; metsPerMinute: (number | null)[] } {
  const series = resolveMinutes('MET/min', [
    ...metGridCandidates(ringGrid, 'oura_ble'),
    ...metGridCandidates(cloudGrid, 'oura_cloud'),
  ], fromMs, toMs)
  return { startTimestampMs: minuteOf(fromMs), metsPerMinute: series.map(r => r.value) }
}

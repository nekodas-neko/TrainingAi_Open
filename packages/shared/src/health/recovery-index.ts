// Recovery Index — a from-scratch, single-night readiness signal (open_health's
// `daily-summaries-and-baselines.md`): from the overnight HR series, find when resting HR
// bottoms out and report the hours between that minimum and wake — an earlier settle means a
// more recovered night. Needs no personal baseline/history, unlike the HRV/RHR-baseline
// contributors elsewhere in the readiness composite.
//
// Mapping raw hours → a 0–100 sub-score isn't calibratable from the export open_health used, so
// this surfaces the raw hours only (same honesty as open_health) — callers decide how/whether to
// fold it into a composite score.

import { rollingMedian } from './hr-smoothing'

export interface RecoveryIndexInput {
  /** Overnight HR series (any order) — the existing 5-min-binned `oura_heartrate` rows work. */
  hrSeries: { timestamp: Date; bpm: number }[]
  wakeTime: Date
}

export interface RecoveryIndexResult {
  /** Hours between the smoothed HR minimum and wake. Clamped to >= 0. */
  hoursToSettle: number
  settledAt: Date
  lowestBpm: number
}

const MEDIAN_WINDOW = 3 // rolling-median smoothing window (points), per open_health's approach

/**
 * Compute the Recovery Index from an overnight HR series. Returns null when there isn't enough
 * data to find a reliable minimum (fewer than 3 points).
 */
export function computeRecoveryIndex(input: RecoveryIndexInput): RecoveryIndexResult | null {
  const { hrSeries, wakeTime } = input
  if (hrSeries.length < 3) return null

  const sorted = [...hrSeries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const smoothed = rollingMedian(sorted.map(p => p.bpm), MEDIAN_WINDOW)

  let minIdx = 0
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] < smoothed[minIdx]) minIdx = i
  }

  const settledAt = sorted[minIdx].timestamp
  const hoursToSettle = Math.max(0, (wakeTime.getTime() - settledAt.getTime()) / 3_600_000)

  return { hoursToSettle, settledAt, lowestBpm: smoothed[minIdx] }
}

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

/** One sleep window of a night, for {@link nightRecoveryIndexHours}. */
export interface NightRecoverySegment {
  /** When this window ended. The LAST window's end is the night's wake time. */
  sleepEnd: Date
  /** This window's own {@link computeRecoveryIndex} result, or null when it had too few points. */
  recovery: { settledAt: Date; lowestBpm: number } | null
}

/**
 * Q-509. The night's Recovery Index when sleep was fragmented into several windows.
 *
 * The metric is *hours between the overnight HR minimum and waking*, and "overnight" is the whole
 * period — so the minimum is taken across every window and the wake time from the last. The rollup
 * previously used the FINAL window's own value, which measures from the lowest point of the last
 * fragment rather than of the night: on a 10pm–2am / 3am–7am night whose true minimum is at 1am, it
 * reported the 3–7am segment's minimum and the number described a different sleep episode.
 *
 * Returns null when no window produced a minimum. Ties keep the EARLIER minimum, matching
 * `computeRecoveryIndex`'s own strict `<` scan, so a night whose two windows bottom out at the same
 * bpm reads the same way a single window would.
 *
 * **This is latent, not observed.** Over 61 BLE-era nights of the owner's data not one night is
 * fragmented under `groupSleepPeriods` — every second window is a daytime nap outside the night
 * band, a zero-duration row, or more than `MAX_INTRA_NIGHT_GAP_HOURS` away — so the merge path has
 * never run in production. It is fixed because the rule is wrong, not because a number moved.
 */
export function nightRecoveryIndexHours(segments: NightRecoverySegment[]): number | null {
  const withMin = segments.filter(
    (s): s is NightRecoverySegment & { recovery: NonNullable<NightRecoverySegment['recovery']> } => s.recovery != null,
  )
  if (withMin.length === 0) return null
  const best = withMin.reduce((a, b) => (b.recovery.lowestBpm < a.recovery.lowestBpm ? b : a))
  const wake = segments[segments.length - 1].sleepEnd.getTime()
  return Math.max(0, (wake - best.recovery.settledAt.getTime()) / 3_600_000)
}

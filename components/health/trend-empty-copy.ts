import type { TrendField } from './trend-sparkline-equal'

/**
 * What a trend card says when its metric has no value on any of the last 14 days (issue 2610).
 *
 * A card that vanishes reads as a layout fault rather than as an absence, so each one that can go
 * empty names what is missing and what produces it. One place, so the wording cannot drift between
 * a screen and its siblings. Heart-rate-based lines name no device: `noHrDataCopy` (`hr-source-copy`)
 * explains why, and these screens do not know which source, if any, this person has.
 *
 * `hrr1Bpm` is the one that does name a device on purpose: recovery is only ever measured from a
 * chest strap.
 *
 * Not listed, deliberately: protein, steps, water, session duration and workout density. Their
 * parent cards already render a sparkline only for a metric that has data and one combined line
 * when none does, so a per-card empty text would never show.
 */
export const TREND_EMPTY = {
  rhrBpm: 'No resting heart rate in the last 14 days. It is worked out from a night of heart-rate data.',
  hrvMs: 'No overnight HRV in the last 14 days. It is measured during a night of heart-rate data.',
  hrr1Bpm: 'No chest-strap workouts in the last 14 days. Recovery is measured from the strap.',
  temperatureDeviation: 'No skin temperature in the last 14 days. It is measured by a ring worn overnight.',
  wornHours: 'No wear time in the last 14 days. It is recorded while a ring is worn.',
} as const satisfies Partial<Record<TrendField, string>>

/** The trend under a score screen ("Readiness", "Sleep", "Activity"). */
export function scoreTrendEmpty(title: string): string {
  return `No ${title.toLowerCase()} scores in the last 14 days. They are worked out from the data your devices record.`
}

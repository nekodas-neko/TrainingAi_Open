/**
 * #3610 — the readiness inputs a source calculates for itself, in shapes any source can fill.
 *
 * Readiness reads these and never a device's own field names. Each value carries the `source` that
 * supplied it, and every normal it joins is keyed on that source, so two sources' values never share
 * a baseline. A connector maps its own fields into them (`docs/data-source-connector-guide.md` §3f):
 *
 * - {@link DailyTemperatureDeviation}: the source's nightly skin-temperature deviation from its own
 *   baseline. Oura maps `daily_readiness.temperature_deviation`; Fitbit's nightly skin temperature
 *   relative to its baseline, or Health Connect's `SkinTemperatureRecord` deltas, map the same way.
 * - {@link RecoveryContributor}: the source's own 0–100 recovery sub-score for a night, used only
 *   when there are no hours. Oura maps the `recovery_index` readiness contributor; Fitbit's or
 *   Garmin's overnight recovery sub-scores would map here.
 * - {@link OvernightRecoveryHours}: recovery-index hours our own code computed from the source's
 *   overnight heart-rate series. Oura's 5-minute sleep series feeds it today; any source with an
 *   overnight heart-rate series (Fitbit's intraday heart rate, Health Connect's `HeartRateRecord`)
 *   could feed the same function.
 * - {@link DaytimeHighStress}: the source's minutes of high daytime stress. Oura maps
 *   `daily_stress.stress_high` (seconds); Garmin's or Fitbit's high-stress minutes would map here.
 *
 * Pure types; importing no node module.
 */

/** A night's skin-temperature deviation, in °C, from the source's own baseline. Keyed by wake date. */
export interface DailyTemperatureDeviation {
  date: string
  deviationC: number
  source: string
  /**
   * A value from an account or calibration the source no longer stands behind (for Oura, the history
   * before the account was re-keyed). It is still tonight's reading for display, but it never scores
   * a night or joins a normal in the live composite.
   */
  superseded?: boolean
}

/** The source's own 0–100 recovery sub-score for a night. Keyed by wake date. */
export interface RecoveryContributor {
  date: string
  score: number
  source: string
  /** Where the value was read from, in words for the score audit. Display only, never branched on. */
  provenance: string
}

/** Recovery-index hours our code computed from the source's overnight heart-rate series. Keyed by wake date. */
export interface OvernightRecoveryHours {
  date: string
  hours: number
  /** The device whose heart-rate series the hours were computed from. */
  source: string
  /** Where the series was read from, in words for the score audit. Display only, never branched on. */
  provenance: string
}

/** Minutes of high daytime stress on a local day, as the source calculated them. */
export interface DaytimeHighStress {
  date: string
  minutes: number
  source: string
}

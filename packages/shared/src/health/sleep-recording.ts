/**
 * #3075 stages 4 and 5: what a sleep source tells us about its own recording of a night, in shapes
 * any source can fill.
 *
 * The owner's condition on approving these stages (3 Nov): the data is interchangeable, "it would
 * work with say a fitbit". So nothing here knows a device. A connector maps its own fields into:
 * - a {@link MovementSeries}: per-epoch movement on our 0-3 scale, with the epoch length it was taken at;
 * - a "recording incomplete" flag: the source says its own record of the night is not the whole night;
 * - the source's algorithm version: the label of the method that turned its raw signal into the night.
 *
 * Which sources fill them today: the Oura Cloud connector maps `movement_30_sec`, `low_battery_alert`
 * and `sleep_algorithm_version` (`lib/oura/cloud/sleep-recording-map.ts`). Fitbit's sleep log has a
 * per-minute `minutesRestless`/`minutesAwake` level series and Health Connect has stage segments,
 * either of which maps to a movement series; a device whose battery died mid-night, or whose
 * recording was cut, maps the incomplete flag; any source that versions its sleep algorithm maps
 * the version. A source that fills none of them leaves every night exactly as it was.
 *
 * Pure and importing no node module, like `oura-sleep-detail`.
 */

/**
 * Movement per epoch on OUR scale, whatever the device's own classes are:
 * - 0: still;
 * - 1: some movement;
 * - 2: more movement;
 * - 3: the most the source distinguishes (active, awake-level movement).
 * `null` is an epoch the source did not measure, which is not stillness.
 */
export type MovementLevel = 0 | 1 | 2 | 3

export interface MovementSeries {
  /** Seconds per epoch. */
  epochSec: number
  /** The start of the first epoch. */
  startAt: Date | string
  levels: readonly (MovementLevel | null)[]
}

/** The lowest level that counts as restless: any movement at all. */
export const RESTLESS_MIN_LEVEL: MovementLevel = 1

/**
 * What makes a movement series good enough to say how restless the night was. Restlessness is a
 * share of the sleep window, so a series holding a fragment of it (the device came off, the source
 * measured few epochs) would state the fragment's share as the night's. So a series is usable only
 * when it has BOTH:
 * - at least {@link MOVEMENT_MIN_MEASURED_MIN} measured minutes, an hour, whatever the epoch length:
 *   the same hour `HYPNOGRAM_MIN_EPOCHS` asks of a hypnogram;
 * - measured epochs covering at least {@link MOVEMENT_MIN_COVERAGE} of the sleep window, the same
 *   lenient half the heart-rate series rule (stage 2) uses.
 * A refused series is not zero restlessness: the night has no restlessness term, which is today's behaviour.
 */
export const MOVEMENT_MIN_MEASURED_MIN = 60
export const MOVEMENT_MIN_COVERAGE = 0.5

export interface NightRestlessness {
  /** Minutes inside the sleep window the series measured movement at or above {@link RESTLESS_MIN_LEVEL}. */
  restlessMin: number
  /** Minutes inside the sleep window the series measured at all. */
  measuredMin: number
  /** `restlessMin / measuredMin`: the share of the measured sleep window spent moving. Our unit. */
  restlessFraction: number
}

/**
 * The night's restlessness from a movement series, counted only inside the sleep window (onset to
 * final wake where the night has them, else the bed window), so lying awake before sleep or after
 * the last sleep epoch is not counted twice beside latency and the wake time. An epoch is inside
 * when its midpoint is. Null when the series is missing or not usable (see {@link MOVEMENT_MIN_COVERAGE}).
 */
export function restlessnessFromMovement(
  series: MovementSeries | null | undefined,
  window: { from: Date; to: Date },
): NightRestlessness | null {
  if (!series || !Array.isArray(series.levels) || !(series.epochSec > 0)) return null
  const startMs = new Date(series.startAt).getTime()
  const fromMs = window.from.getTime()
  const toMs = window.to.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null
  const epochMs = series.epochSec * 1000
  let measured = 0
  let restless = 0
  series.levels.forEach((level, i) => {
    const mid = startMs + (i + 0.5) * epochMs
    if (mid < fromMs || mid >= toMs || level == null) return
    measured++
    if (level >= RESTLESS_MIN_LEVEL) restless++
  })
  const epochMin = series.epochSec / 60
  const measuredMin = measured * epochMin
  const windowEpochs = (toMs - fromMs) / epochMs
  if (measuredMin < MOVEMENT_MIN_MEASURED_MIN || measured / windowEpochs < MOVEMENT_MIN_COVERAGE) return null
  const restlessMin = restless * epochMin
  return { restlessMin, measuredMin, restlessFraction: restlessMin / measuredMin }
}

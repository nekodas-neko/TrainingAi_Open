/**
 * What a 14-day sparkline should draw where it has no reading.
 *
 * The chart used to pass `spanGaps: true`, so Chart.js joined the last value before a run of nulls
 * straight to the first one after it. A missing day was therefore drawn as a smooth interpolated
 * line — indistinguishable from a measured one. That is the same fabricated number TN-53's engine
 * gate was added to stop `analyseHrRecovery` emitting: the gate made the day honest and the chart
 * put the invention back.
 *
 * Refusing to span leaves a second problem, which is the reason this is a function rather than one
 * flag. A line segment needs two adjacent points, and the chart draws no dot except on the last
 * day — so a single reading with nothing either side of it renders as **nothing at all**, and a
 * sparse series can disappear entirely while reporting no error. The sparse case is the normal one
 * here: `ble` heart-rate sessions carry 7.1 readings per set against the chest strap's 111.8.
 */

import { seriesShape, standaloneOrLatest, type SeriesShape } from '@trainingai/shared/health/series-gaps'

// `seriesShape` (what is missing, and the "N days missing" note) is shared with the native app.
export { seriesShape, type SeriesShape }

/** Radius for a point the line cannot show on its own, and for the latest reading. */
export const VISIBLE_POINT_RADIUS = 3

/**
 * The Chart.js dataset fields that decide how absence is drawn, spread onto the dataset so both
 * halves are pinned by a node test. `spanGaps` is typed to the literal `false` deliberately: it is
 * the flag whose reversion silently reinstates the fabricated line, and the type stops that being
 * a one-character edit in the component.
 */
export interface GapDataset {
  pointRadius: number[]
  spanGaps: false
  coverage: string | null
}

export function gapDataset(values: (number | null | undefined)[]): GapDataset {
  const shape = seriesShape(values)
  return {
    pointRadius: standaloneOrLatest(values).map(dot => (dot ? VISIBLE_POINT_RADIUS : 0)),
    spanGaps: false,
    coverage: shape.coverage,
  }
}

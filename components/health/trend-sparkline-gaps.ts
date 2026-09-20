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

export interface SeriesShape {
  /** Per point: draw its own dot, because no neighbouring value can form a segment with it. */
  isolated: boolean[]
  /** Days carrying a value, of the days drawn. */
  present: number
  drawn: number
  /**
   * `null` when nothing is missing — a caveat that prints on every chart stops being read on the
   * one that needs it.
   *
   * Phrased as the count MISSING rather than "11 of 14", because the series drawn is not the
   * window named: leading nulls are trimmed, so the denominator would disagree with the card's own
   * "— 14 days" label and leave the reader doing arithmetic to find out which number is wrong.
   */
  coverage: string | null
}

export function seriesShape(values: (number | null | undefined)[]): SeriesShape {
  const has = values.map(v => v != null)
  const isolated = has.map((present, i) => present && !has[i - 1] && !has[i + 1])
  const present = has.filter(Boolean).length
  const drawn = values.length
  const missing = drawn - present
  return {
    isolated,
    present,
    drawn,
    coverage: missing === 0 ? null : `${missing} day${missing === 1 ? '' : 's'} missing`,
  }
}

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
    pointRadius: values.map((_, i) =>
      i === values.length - 1 || shape.isolated[i] ? VISIBLE_POINT_RADIUS : 0),
    spanGaps: false,
    coverage: shape.coverage,
  }
}

import { plural } from '../format/plural'

/** How much of a day-by-day series has a reading, and what a chart should say about the rest. */
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
    coverage: missing === 0 ? null : `${plural(missing, 'day', 'days')} missing`,
  }
}


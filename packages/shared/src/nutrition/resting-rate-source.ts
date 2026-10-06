/** Which branch produced the resting rate the budget is anchored to (#2413). */
export type RestingRateSource = 'measured' | 'formula'

/**
 * How the energy explainer names the resting rate. It used to print "your measured resting rate"
 * whenever one was set, but the rate is `measuredBmr ?? formula` and the payload did not say which.
 *
 * A measured rate is the test re-scaled onto TODAY's fat-free mass (`personalRmr`), so the date
 * alone would be subtly false: it is carried forward from that test, not the test's own figure.
 * A payload cached before the source existed names neither, and says neither.
 */
export function restingRateWording(
  source: RestingRateSource | undefined,
  measuredOn: string | null | undefined,
  formatDate: (isoDay: string) => string,
): { label: string; note: string | null } {
  if (source === 'measured') {
    return {
      label: 'your resting rate',
      note: measuredOn ? `carried forward from your ${formatDate(measuredOn)} test` : 'carried forward from your test',
    }
  }
  if (source === 'formula') return { label: 'your estimated resting rate', note: null }
  return { label: 'your resting rate', note: null }
}

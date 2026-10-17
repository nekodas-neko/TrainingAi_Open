import { describe, expect, it } from 'vitest'
import { hrvBaselineBand, hrvBaselineDeviationPct } from '../hrv-baseline'
import { scoreBand } from '../score-band'

// The mapping used to be written inline in app/health/health-sections.tsx and again in the native
// body-view. This pins the shared copy to that inline expression on the same inputs.
const inlineBefore = (recent: number, baseline: number) => {
  const deviationPct = Math.round(((recent - baseline) / baseline) * 100)
  return { deviationPct, band: scoreBand(70 + 2 * deviationPct) }
}

describe('hrv baseline', () => {
  const cases: [number, number][] = [
    [50, 50], [55, 50], [45, 50], [44, 50], [47.5, 50], [30, 50], [80, 50], [62, 68], [41.4, 44.2],
  ]
  it.each(cases)('recent %s vs baseline %s matches the former inline maths', (recent, baseline) => {
    const before = inlineBefore(recent, baseline)
    const pct = hrvBaselineDeviationPct(recent, baseline)
    expect(pct).toBe(before.deviationPct)
    expect(hrvBaselineBand(pct)).toEqual(before.band)
  })

  it('keeps the break points: 0% is High, -10% is Moderate, below that is Low', () => {
    expect(hrvBaselineBand(0).label).toBe('High')
    expect(hrvBaselineBand(-1).label).toBe('Moderate')
    expect(hrvBaselineBand(-10).label).toBe('Moderate')
    expect(hrvBaselineBand(-11).label).toBe('Low')
  })
})

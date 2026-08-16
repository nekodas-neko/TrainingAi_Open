import { describe, it, expect } from 'vitest'
import { linearFit, projectRm } from '@trainingai/shared/health/strength-projection'

describe('linearFit', () => {
  it('fits an exact line', () => {
    const fit = linearFit([{ x: 0, y: 100 }, { x: 7, y: 102 }, { x: 14, y: 104 }])!
    expect(fit.slope).toBeCloseTo(2 / 7, 6)      // kg per day
    expect(fit.intercept).toBeCloseTo(100, 6)
  })
  it('returns null for fewer than 2 points', () => {
    expect(linearFit([{ x: 0, y: 100 }])).toBeNull()
  })
})

describe('projectRm', () => {
  const day = (n: number) => {
    const d = new Date(Date.UTC(2026, 5, 1 + n))
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${d.getUTCFullYear()}-${mm}-${dd}`
  }

  it('projects 30 days ahead from a rising series', () => {
    const out = projectRm([
      { date: day(0), rm: 100 }, { date: day(7), rm: 102 }, { date: day(14), rm: 104 },
    ])!
    // slope 2/7 kg/day → 104 + 30 × 0.285714 = 112.57
    expect(out.projectedRm).toBeCloseTo(112.57, 1)
    expect(out.slopePerWeek).toBeCloseTo(2, 3)
    expect(out.plateau).toBe(false)
  })
  it('flags a plateau on a flat series spanning 3+ weeks with 4+ points', () => {
    const out = projectRm([
      { date: day(0), rm: 100 }, { date: day(7), rm: 100.1 },
      { date: day(14), rm: 99.9 }, { date: day(21), rm: 100 },
    ])!
    // least-squares slope = -0.7/245 kg/day → -0.02 kg/week, well under 0.2%/week of 100 kg
    expect(out.slopePerWeek).toBeCloseTo(-0.02, 2)
    expect(out.plateau).toBe(true)
  })
  it('never flags a plateau on short or sparse series', () => {
    expect(projectRm([{ date: day(0), rm: 100 }, { date: day(7), rm: 100 }])?.plateau ?? false).toBe(false)
  })
})

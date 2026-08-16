import { describe, it, expect } from 'vitest'
import { updateBaseline, baselineMean, baselineDeviation, baselineZ, type Baseline } from '../personal-baseline'

describe('updateBaseline', () => {
  // Ported verbatim from open_oura's baseline.rs `warm_up_then_settle` test —
  // ground-truth against the pinned decompile source.
  it('warms up fast then settles to the mature target within the fixed-point deadband', () => {
    let b: Baseline | null = null
    b = updateBaseline(b, 100, 0) // delta 800 -> +400
    expect(b.meanX8).toBe(400)
    b = updateBaseline(b, 100, 0) // delta 400 -> +200
    expect(b.meanX8).toBe(600)
    for (let i = 0; i < 400; i++) {
      b = updateBaseline(b, 100, 30) // mature: slow convergence toward 800 (=100*8)
    }
    expect(Math.abs(baselineMean(b) - 100)).toBeLessThan(2.5)
  })

  it('has no z-score until deviation has accumulated', () => {
    // A first-ever sample already makes dev_x8 nonzero (absd = |800 - 400| = 400 != 0)
    // — z is only null while dev_x8 stays exactly 0 (a perfectly repeated identical
    // sample from a zero baseline).
    expect(baselineZ({ meanX8: 0, devX8: 0 }, 100)).toBeNull()
  })

  it('reports a positive z-score for a sample above a settled baseline', () => {
    let b: Baseline | null = null
    for (let i = 0; i < 50; i++) b = updateBaseline(b, 100, 30)
    const z = baselineZ(b!, 110)
    expect(z).not.toBeNull()
    expect(z!).toBeGreaterThan(0)
  })

  it('mean/deviation accessors divide the ×8 fixed-point state', () => {
    const b: Baseline = { meanX8: 800, devX8: 40 }
    expect(baselineMean(b)).toBe(100)
    expect(baselineDeviation(b)).toBe(5)
  })
})

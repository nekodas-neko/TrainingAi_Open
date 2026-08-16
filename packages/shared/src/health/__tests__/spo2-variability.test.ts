import { describe, it, expect } from 'vitest'
import { spo2VariabilityFromSamples, MIN_SPO2_SAMPLES } from '../spo2-variability'

describe('spo2VariabilityFromSamples', () => {
  it('returns null below the sample floor rather than a spread built from a handful of readings', () => {
    const few = Array(MIN_SPO2_SAMPLES - 1).fill(0).map((_, i) => 96 + i * 0.5)
    expect(spo2VariabilityFromSamples(few)).toBeNull()
    expect(spo2VariabilityFromSamples([])).toBeNull()
  })

  it('is zero for a perfectly flat epoch and positive for a wobbling one', () => {
    expect(spo2VariabilityFromSamples([97, 97, 97, 97, 97, 97])).toBe(0)
    expect(spo2VariabilityFromSamples([95, 99, 94, 100, 96, 98])!).toBeGreaterThan(0)
  })

  it('ranks a wobbling epoch above a steady one', () => {
    const steady = spo2VariabilityFromSamples([97, 97.2, 96.9, 97.1, 97, 97.1])!
    const wobbly = spo2VariabilityFromSamples([93, 99, 94, 100, 95, 98])!
    expect(wobbly).toBeGreaterThan(steady)
  })

  it('drops implausible readings before measuring spread, and re-applies the floor to what is left', () => {
    // A 40% artefact next to six real readings would otherwise dominate the SD entirely.
    const real = [97, 97.2, 96.9, 97.1, 97, 97.1]
    expect(spo2VariabilityFromSamples([...real, 40])).toBeCloseTo(spo2VariabilityFromSamples(real)!, 10)
    // Once the artefacts are gone there are too few readings left to trust a spread.
    expect(spo2VariabilityFromSamples([97, 97, 40, 12, 0, 250])).toBeNull()
  })

  it('ignores non-finite samples', () => {
    expect(spo2VariabilityFromSamples([97, NaN, 97, Infinity, 97, 97, 97, 97])).toBe(0)
  })
})

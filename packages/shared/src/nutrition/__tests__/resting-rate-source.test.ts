import { describe, it, expect } from 'vitest'
import { restingRateWording } from '../resting-rate-source'

const fmt = (d: string) => `<${d}>`

describe('restingRateWording (#2413)', () => {
  it('a measured rate is carried forward from the test, never the test’s own figure', () => {
    expect(restingRateWording('measured', '2026-08-27', fmt)).toEqual({
      label: 'your resting rate', note: 'carried forward from your <2026-08-27> test',
    })
  })

  it('a measured rate with no date still does not claim a date', () => {
    expect(restingRateWording('measured', null, fmt).note).toBe('carried forward from your test')
  })

  it('a formula rate says it is an estimate and cites no test', () => {
    expect(restingRateWording('formula', null, fmt)).toEqual({ label: 'your estimated resting rate', note: null })
  })

  it('a payload cached before the source existed claims neither', () => {
    const w = restingRateWording(undefined, undefined, fmt)
    expect(w).toEqual({ label: 'your resting rate', note: null })
    expect(w.label).not.toMatch(/measured|estimated/)
  })

  it('never uses the word "measured" for anything but a measured rate', () => {
    for (const source of ['formula', undefined] as const) {
      const w = restingRateWording(source, '2026-08-27', fmt)
      expect(`${w.label} ${w.note ?? ''}`).not.toMatch(/measured/)
    }
  })
})

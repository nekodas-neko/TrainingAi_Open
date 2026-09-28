// LB-153 — the owner's rule for the one categorical palette: no colour in it may also mean
// good / warning / bad elsewhere in the app. Pinned against the verdict colours the app actually
// uses, and against the generated tail staying inside the blue-to-pink band.
import { describe, it, expect } from 'vitest'
import { CATEGORICAL_PALETTE, categoricalColor } from '../chart-colors'
import { acwrBand } from '../ai-periodization/acwr'

// The green / amber / red family the app spends on verdicts: score bands, ACWR, calibration ratings.
const VERDICT = ['#22c55e', '#84cc16', '#f59e0b', '#eab308', '#f97316', '#ef4444']

describe('the categorical palette (LB-153)', () => {
  it('contains no verdict colour', () => {
    const acwr = [0, 1, 1.4, 2].map(v => acwrBand(v).color.toLowerCase())
    for (const c of CATEGORICAL_PALETTE) {
      expect(VERDICT).not.toContain(c.toLowerCase())
      expect(acwr).not.toContain(c.toLowerCase())
    }
  })

  it('has six distinct colours, and index i is stable', () => {
    expect(new Set(CATEGORICAL_PALETTE).size).toBe(6)
    expect(categoricalColor(1)).toBe(CATEGORICAL_PALETTE[1])
  })

  it('keeps every generated colour past the table inside the blue-to-pink band', () => {
    for (let i = CATEGORICAL_PALETTE.length; i < 60; i++) {
      const hue = Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(categoricalColor(i))![1])
      expect(hue).toBeGreaterThanOrEqual(200)
      expect(hue).toBeLessThanOrEqual(330)
    }
  })
})

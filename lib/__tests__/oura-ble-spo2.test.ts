// Pinned to open_oura docs/spo2-calibration.md ("SpO₂ Simple" path): the gen4/oreo
// quadratic over the ring's R ratio-of-ratios, clamped [85,100]. The doc's observed
// overnight mean (~93.4% at r≈0.78) anchors the mid-range expectation.
import { describe, it, expect } from 'vitest'
import { spo2PctFromR, SPO2_COEFFS } from '@/lib/oura-ble/spo2'

describe('spo2PctFromR', () => {
  it('converts a typical overnight R to ~93%', () => {
    // r = 0.783 is the first sample of the pinned 0x8b decode vector.
    expect(spo2PctFromR(0.783)).toBeCloseTo(92.99, 2)
  })

  it('clamps to 100 for tiny R and 85 for large R', () => {
    expect(spo2PctFromR(0.1)).toBe(100)
    expect(spo2PctFromR(2)).toBe(85)
  })

  it('rejects non-physical R', () => {
    expect(spo2PctFromR(0)).toBeNull()
    expect(spo2PctFromR(-0.5)).toBeNull()
    expect(spo2PctFromR(NaN)).toBeNull()
    expect(spo2PctFromR(Infinity)).toBeNull()
  })

  it('the two known coefficient sets agree within 1% in the physiological range', () => {
    for (const r of [0.5, 0.6, 0.7, 0.78, 0.85, 0.95]) {
      const g = SPO2_COEFFS.gen4
      const c = SPO2_COEFFS.cooper
      const gen4 = g.a * r * r + g.b * r + g.c
      const cooper = c.a * r * r + c.b * r + c.c
      expect(Math.abs(gen4 - cooper)).toBeLessThan(1)
    }
  })
})

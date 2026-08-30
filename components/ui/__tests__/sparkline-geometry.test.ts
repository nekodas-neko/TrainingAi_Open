import { describe, it, expect } from 'vitest'
import { sparklinePoints } from '../sparkline-geometry'

/**
 * The sparkline's projection (Q-154).
 *
 * These exist because `valuePadding` is the prop that changes what a chart *says* rather than how it
 * looks, and because the entry that converted two callers onto this primitive was refused twice for
 * shipping that change blind.
 */
describe('sparklinePoints', () => {
  /** A 0.5 kg body-weight spread — the exact series Q-154 named. */
  const weights = [80.0, 80.25, 80.5]

  it('the default padding halves a small amplitude — the hazard, pinned', () => {
    const pts = sparklinePoints({ values: weights, width: 100, height: 60, valuePadding: 0.5 })
    const ys = pts.map(p => p.y)
    const drawnSpan = Math.max(...ys) - Math.min(...ys)
    // Data spans 0.5 across a padded domain of 1.5, so it uses a third of the usable height.
    const usable = 60 * 0.8
    expect(drawnSpan).toBeCloseTo(usable / 3, 5)
    expect(drawnSpan).toBeLessThan(usable / 2)
  })

  it('valuePadding 0 gives the series the full inner height', () => {
    const pts = sparklinePoints({ values: weights, width: 100, height: 60, pad: 10, valuePadding: 0 })
    const ys = pts.map(p => p.y)
    // Exactly the inner height: lowest value on the bottom inset, highest on the top one.
    expect(Math.max(...ys)).toBeCloseTo(50, 5)   // height - pad
    expect(Math.min(...ys)).toBeCloseTo(10, 5)   // pad
  })

  it('pad insets both axes, and the first and last points sit on the insets', () => {
    const pts = sparklinePoints({ values: [1, 2, 3], width: 280, height: 60, pad: 4, valuePadding: 0 })
    expect(pts[0].x).toBeCloseTo(4, 5)
    expect(pts[pts.length - 1].x).toBeCloseTo(276, 5)
  })

  it('without pad, x still spans the full width — the 20 call sites that predate the prop', () => {
    const pts = sparklinePoints({ values: [1, 2, 3], width: 120, height: 40, valuePadding: 0.5 })
    expect(pts[0].x).toBeCloseTo(0, 5)
    expect(pts[pts.length - 1].x).toBeCloseTo(120, 5)
    // The original 10%/80% band, unchanged.
    expect(pts[0].y).toBeCloseTo(40 - (1 - 0.5) / 3 * 32 - 4, 5)
  })

  it('a flat series draws one line rather than dividing by zero', () => {
    const pts = sparklinePoints({ values: [5, 5, 5], width: 100, height: 60, pad: 10, valuePadding: 0 })
    expect(pts.every(p => Number.isFinite(p.y))).toBe(true)
    expect(new Set(pts.map(p => p.y.toFixed(6))).size).toBe(1)
  })

  it('times project by position in the domain, inside the inset', () => {
    const pts = sparklinePoints({
      values: [1, 2, 3], times: [0, 75, 100], timeDomain: [0, 100],
      width: 200, height: 60, pad: 10, valuePadding: 0,
    })
    // 75% of the 180px inner width, offset by the inset — not the 50% an index projection gives.
    expect(pts[1].x).toBeCloseTo(10 + 0.75 * 180, 5)
  })

  it('a times array that does not match values falls back to index projection', () => {
    const pts = sparklinePoints({
      values: [1, 2, 3], times: [0, 50], timeDomain: [0, 100],
      width: 200, height: 60, valuePadding: 0,
    })
    expect(pts[1].x).toBeCloseTo(100, 5)
  })
})

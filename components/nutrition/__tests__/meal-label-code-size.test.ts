import { describe, it, expect } from 'vitest'
import {
  mealLabelCodeMetrics, MEAL_LABEL_STYLES, DEFAULT_MEAL_LABEL_STYLE,
} from '../meal-label-render'

/**
 * Q-397 asks for the printed code size to be asserted rather than trusted: *"the preview's own size
 * figure was wrong once already, so a number nobody asserts is a number that drifts."* It was — the
 * figure shipped in v1.320.0 divided by the module count and not by the module count plus the quiet
 * zone the renderer draws inside the box, reading ~24% large across every style.
 *
 * These are the numbers a printer actually has to reproduce.
 */
describe('meal label code size', () => {
  it('every style has a code, and none is smaller than the tightest shipped one', () => {
    for (const s of MEAL_LABEL_STYLES) {
      const { mmPerModule } = mealLabelCodeMetrics(s.value)
      expect(mmPerModule, `${s.value}`).toBeGreaterThanOrEqual(0.36)
    }
  })

  /**
   * **The claim the owner's decision rests on** (Q-397: *"Yes have B2 as the default"*): the new
   * default prints a *more forgiving* code than the old one while also carrying the ingredient list.
   * If a later layout tweak ever reverses that, this fails rather than a print run failing.
   */
  it('the default prints a bigger module than the style it replaced', () => {
    const now = mealLabelCodeMetrics(DEFAULT_MEAL_LABEL_STYLE).mmPerModule
    const before = mealLabelCodeMetrics('band').mmPerModule
    expect(DEFAULT_MEAL_LABEL_STYLE).toBe('inlineCentred')
    expect(now).toBeGreaterThan(before)
    expect(now).toBeCloseTo(0.529, 3)
    expect(before).toBeCloseTo(0.369, 3)
  })

  it('reports the symbol as 25/33 of the drawn box, since the quiet zone sits inside it', () => {
    const { boxMm, symbolMm, mmPerModule } = mealLabelCodeMetrics('inlineCentred')
    expect(symbolMm).toBeCloseTo(boxMm * 25 / 33, 6)
    expect(symbolMm / 25).toBeCloseTo(mmPerModule, 6)
    expect(symbolMm).toBeCloseTo(13.2, 1)   // Q-397's measured figure for B2
  })
})

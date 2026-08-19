import { describe, it, expect } from 'vitest'
import {
  mealLabelCodeMetrics, MEAL_LABEL_STYLES, DEFAULT_MEAL_LABEL_STYLE,
  centredStackLineBudget, mealLabelStyleSpec,
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
  /**
   * Raised 0.36 → 0.49 with Q-411's square canvas. A floor the whole set clears by a wide margin is
   * not a floor: after the round constraint was retired the tightest style moved from 0.369 to
   * 0.497, so the old number could no longer fail for any style and stopped being a test.
   *
   * 0.49 and not the 0.52 an area calculation suggests, because `codeUnits` is bounded by VERTICAL
   * fit rather than by the area freed — see the note above `StyleSpec`.
   */
  it('every style has a code, and none is smaller than the tightest shipped one', () => {
    for (const s of MEAL_LABEL_STYLES) {
      const { mmPerModule } = mealLabelCodeMetrics(s.value)
      expect(mmPerModule, `${s.value}`).toBeGreaterThanOrEqual(0.49)
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
    expect(now).toBeCloseTo(0.561, 3)
    expect(before).toBeCloseTo(0.497, 3)
  })

  it('reports the symbol as 25/33 of the drawn box, since the quiet zone sits inside it', () => {
    const { boxMm, symbolMm, mmPerModule } = mealLabelCodeMetrics('inlineCentred')
    expect(symbolMm).toBeCloseTo(boxMm * 25 / 33, 6)
    expect(symbolMm / 25).toBeCloseTo(mmPerModule, 6)
    expect(symbolMm).toBeCloseTo(14.0, 1)   // Q-411's square-canvas B2
  })
})

/**
 * **Q-399.** `inlineCentred` shipped as the default with `codeUnits: 66` and a header that consumed
 * 96.5 of its 137 available units, leaving `floor((97 − 96.5 − 2) / 8)` = **zero** ingredient lines.
 * A style whose entire premise is the per-serving breakdown printed none, at every name length, and
 * nothing failed: the renderer returned 0, the sheet's "Printing N ingredients" copy is gated on
 * `> 0` so it silently vanished, and the picker went on promising the full list. The owner found it
 * by looking at a label.
 *
 * These assert the promise itself rather than a constant. A style that claims a breakdown and has
 * no room to draw one fails CI now, instead of a print run.
 */
describe('centred-stack ingredient budget', () => {
  it('every style that claims a breakdown has room to draw one', () => {
    for (const s of MEAL_LABEL_STYLES) {
      const spec = mealLabelStyleSpec(s.value)
      if (!spec.ingredients || spec.layout !== 'stack') continue
      const { maxLines } = centredStackLineBudget(s.value)
      expect(maxLines, `${s.value} promises an ingredient list`).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * Raised 3 → 4 with Q-411. The square canvas gives the stack 34 more units of height, so three
   * lines became trivially true and the assertion stopped being able to fail. The default now draws
   * **four** lines *and* a larger code than before — the point of retiring the round constraint.
   */
  it('the default draws the four lines the square canvas affords', () => {
    const { maxLines } = centredStackLineBudget(DEFAULT_MEAL_LABEL_STYLE)
    expect(maxLines).toBeGreaterThanOrEqual(4)
  })

  /**
   * The regression in its exact original shape: restore v1.324.6's header and code box and the
   * budget must go to zero. Without this, a future tweak that quietly re-inflates the header reads
   * as a smaller list rather than as no list at all.
   */
  it('reproduces the v1.324.6 geometry as zero lines', () => {
    const SHEET = 189, USABLE_H = 137
    const L = (SHEET - USABLE_H) / 2
    const bottom = SHEET - (SHEET - USABLE_H) / 2
    let y = L + 4
    y += 12 + 7        // name 12, gap 7
    y += 21 + 6        // calories 21, gap 6
    y += 7.5 + 5       // macros 7.5, gap 5
    y += 8             // rule gap
    const codeTop = bottom - 66
    expect(Math.max(0, Math.floor((codeTop - y - 2) / 8))).toBe(0)
  })

  /**
   * Q-399's own recommendation was "do not simply set it to 58" — the spec comment that reasoned
   * 58 units was computed against the wrong gaps too, and 58 yields zero lines just as 66 does.
   */
  it('58 units would not have fixed it either', () => {
    const SHEET = 189, USABLE_H = 137
    const bottom = SHEET - (SHEET - USABLE_H) / 2
    const y = 96.5     // v1.324.6's header
    expect(Math.max(0, Math.floor((bottom - 58 - y - 2) / 8))).toBe(0)
  })
})

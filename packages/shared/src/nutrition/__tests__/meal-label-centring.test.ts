import { describe, it, expect } from 'vitest'
import {
  centredStackOffset, centredStackLineBudget, mealLabelStyleSpec, DEFAULT_MEAL_LABEL_STYLE,
} from '../meal-label-geometry'

/** The renderer's own units: 189 per 50 mm sheet. */
const UNITS_PER_MM = 189 / 50
const mm = (units: number) => units / UNITS_PER_MM
const STACK_LINE_H = 8

describe('centredStackOffset (Q-416)', () => {
  it('shares the leftover between the top margin and the code', () => {
    // 40 units unused → 20 above, 20 below. The old layout put all 40 above the code.
    expect(centredStackOffset({ contentEnd: 70, codeTop: 110 })).toBe(20)
  })

  it('is zero when the content exactly reaches the code', () => {
    expect(centredStackOffset({ contentEnd: 110, codeTop: 110 })).toBe(0)
  })

  it('never pulls an overfull block up through the top margin', () => {
    // `maxLines` clamps this already, so it guards a future style rather than a live case — but a
    // negative offset would push the name off the top of the label, which is not a degraded layout.
    expect(centredStackOffset({ contentEnd: 130, codeTop: 110 })).toBe(0)
  })

  /**
   * The defect in the owner's words: *"much better more gap between the text"*. A one-ingredient
   * meal left **8.6 mm** of dead band immediately above the code — an eighth of the label — while a
   * four-ingredient meal looked right. That asymmetry is why it survived review.
   *
   * After the fix the worst case is half of it, and it sits ABOVE the block rather than as a gap
   * inside it, which is what "centred" means.
   */
  it('halves the worst-case void on the shipped default', () => {
    const { headerUnits, codeTop } = centredStackLineBudget(DEFAULT_MEAL_LABEL_STYLE)

    const voidFor = (lines: number) => codeTop - (headerUnits + lines * STACK_LINE_H)
    const before = voidFor(1)
    expect(mm(before)).toBeGreaterThan(8)          // the reported 8.6 mm

    const after = before - centredStackOffset({
      contentEnd: headerUnits + 1 * STACK_LINE_H, codeTop,
    })
    expect(after).toBeCloseTo(before / 2, 6)
    expect(mm(after)).toBeLessThan(4.5)
  })

  it('a fuller list is shifted less, and every list still clears the code', () => {
    // The block's own height is what varies; `codeTop` is an input the offset never moves. So a
    // two-line meal is pushed further down than a six-line one, and neither can reach the code.
    const { headerUnits, codeTop } = centredStackLineBudget(DEFAULT_MEAL_LABEL_STYLE)
    const endFor = (lines: number) => headerUnits + lines * STACK_LINE_H

    const two = centredStackOffset({ contentEnd: endFor(2), codeTop })
    const four = centredStackOffset({ contentEnd: endFor(4), codeTop })
    expect(two).toBeGreaterThan(four)
    for (const [lines, off] of [[2, two], [4, four]] as const) {
      expect(endFor(lines) + off, `${lines} lines`).toBeLessThanOrEqual(codeTop)
    }
  })

  it('every style that draws the centred stack has a non-negative offset at every line count', () => {
    for (const style of ['inlineCentred', 'band', 'editorial', 'ticket', 'plaque'] as const) {
      const { headerUnits, codeTop, maxLines } = centredStackLineBudget(style)
      for (let lines = 0; lines <= maxLines; lines++) {
        const off = centredStackOffset({ contentEnd: headerUnits + lines * STACK_LINE_H, codeTop })
        expect(off, `${style} @ ${lines} lines`).toBeGreaterThanOrEqual(0)
        // And the shifted block must still clear the code — half of a non-negative slack always does.
        expect(headerUnits + lines * STACK_LINE_H + off, `${style} @ ${lines}`).toBeLessThanOrEqual(codeTop)
      }
    }
  })

  it('the default style still promises the ingredient lines it prints', () => {
    // Guards the obvious way to break this: shifting the block down must not eat the line budget.
    // The offset is applied AFTER `maxLines` is computed, so the count is unchanged by the fix.
    expect(centredStackLineBudget(DEFAULT_MEAL_LABEL_STYLE).maxLines).toBeGreaterThanOrEqual(4)
    expect(mealLabelStyleSpec(DEFAULT_MEAL_LABEL_STYLE).ingredients).toBe(true)
  })
})

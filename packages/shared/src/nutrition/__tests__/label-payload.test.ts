import { describe, it, expect } from 'vitest'
import {
  encodeMealLabelToken,
  decodeMealLabelToken,
  mealLabelFigures,
  mealLabelFiguresFromItems,
  MEAL_LABEL_TOKEN_LENGTH,
  QR_V2_M_BYTE_CAPACITY,
  fitIngredientLines,
  wrapIngredientRun,
} from '../label-payload'
import type { SavedMeal, FoodItem } from '../../types/nutrition'

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'f1', userId: 'u', name: 'Whey', servingSizeG: 30,
    calories: 120, proteinG: 25, carbsG: 2, fatG: 1,
    source: 'manual', region: 'AU', createdAt: new Date(), ...over,
  }
}

function meal(servings: number, qty = 2): SavedMeal {
  const f = food()
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', userId: 'u', name: 'Ninja Creami',
    servings, createdAt: new Date(),
    items: [{ id: 'i1', savedMealId: 'm1', foodItemId: 'f1', quantityMultiplier: qty, foodItem: f }],
    // The WHOLE recipe, which is what SavedMeal.totals means — DERIVED from the items rather than
    // hardcoded, because that is the only relationship the server ever writes. A fixture that fixes
    // totals independently of qty makes the label/write-path agreement below untestable: the first
    // draft did exactly that and the 1.5-serving case failed on the fixture, not on the code.
    totals: {
      calories: f.calories * qty, proteinG: f.proteinG * qty,
      carbsG: f.carbsG * qty, fatG: f.fatG * qty,
    },
  }
}

describe('encodeMealLabelToken', () => {
  it('round-trips a uuid', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(decodeMealLabelToken(encodeMealLabelToken(id))).toBe(id)
  })

  it('round-trips ids with high bytes, zero bytes and every nibble', () => {
    for (const id of [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'fe481797-4114-4f59-824d-223e0281823e',
      '01234567-89ab-cdef-0123-456789abcdef',
    ]) {
      expect(decodeMealLabelToken(encodeMealLabelToken(id))).toBe(id)
    }
  })

  it('normalises an uppercase uuid to lowercase, so the token is stable', () => {
    const lower = 'fe481797-4114-4f59-824d-223e0281823e'
    expect(encodeMealLabelToken(lower.toUpperCase())).toBe(encodeMealLabelToken(lower))
  })

  it('rejects anything that is not a uuid rather than encoding nonsense', () => {
    for (const bad of ['', 'not-a-uuid', '3f2504e04f8941d39a0c0305e82c3301']) {
      expect(() => encodeMealLabelToken(bad)).toThrow()
    }
  })

  /**
   * The guard the whole design rests on. A version-2 QR at EC level M holds 26 bytes; the token is
   * 22. If anyone ever widens the payload — a name, a `ta:` prefix, a revision — this fails here
   * rather than in a print run, which is the only other place it would show up.
   */
  it('stays inside the version-2 / EC-M byte budget', () => {
    const token = encodeMealLabelToken('fe481797-4114-4f59-824d-223e0281823e')
    expect(token).toHaveLength(MEAL_LABEL_TOKEN_LENGTH)
    expect(token.length).toBeLessThanOrEqual(QR_V2_M_BYTE_CAPACITY)
  })
})

describe('decodeMealLabelToken', () => {
  // Recognition is by shape because the payload cannot afford a prefix. These are the shapes the
  // scanner actually returns alongside a label, and none may be mistaken for a meal id.
  it('returns null for a barcode, not a meal id', () => {
    expect(decodeMealLabelToken('9300675024235')).toBeNull()  // EAN-13
    expect(decodeMealLabelToken('012345678905')).toBeNull()   // UPC-A
  })

  it('returns null for the wrong length, wrong alphabet, or empty input', () => {
    expect(decodeMealLabelToken('')).toBeNull()
    expect(decodeMealLabelToken('short')).toBeNull()
    expect(decodeMealLabelToken('a'.repeat(21))).toBeNull()
    expect(decodeMealLabelToken('a'.repeat(23))).toBeNull()
    // 22 chars but base64 (not base64url) — '+' and '/' are outside the alphabet.
    expect(decodeMealLabelToken('a+b/cdefghijklmnopqrst')).toBeNull()
  })

  it('returns null for a url, which is what a naive payload change would produce', () => {
    expect(decodeMealLabelToken('https://example.com/m/abc')).toBeNull()
  })
})

describe('mealLabelFigures', () => {
  /**
   * **The assertion this feature exists to keep true.** `SavedMeal.totals` is the whole recipe and
   * scanning the label logs one serving, so a renderer reading `totals` prints double on a
   * two-serving batch. Both halves are asserted against each other in one test on purpose: checking
   * them separately would pass even if they had drifted apart, which is the failure mode.
   */
  it('prints per serving, agreeing with what scanning the label would log', () => {
    const m = meal(2)
    const printed = mealLabelFigures(m)
    const logged = mealLabelFiguresFromItems(m)

    expect(printed.calories).toBe(120)
    expect(printed).toMatchObject(logged)
  })

  it('agrees with the write path for a single-serving meal too', () => {
    const m = meal(1)
    expect(mealLabelFigures(m)).toMatchObject(mealLabelFiguresFromItems(m))
    expect(mealLabelFigures(m).calories).toBe(240)
  })

  it('agrees for a non-integer batch size', () => {
    // 1.5 servings is legal — doublePrecision — and is where an integer-only assumption would show.
    const m = meal(1.5, 3)
    expect(mealLabelFigures(m)).toMatchObject(mealLabelFiguresFromItems(m))
  })

  it('treats a zero or missing serving count as one rather than dividing by zero', () => {
    expect(mealLabelFigures(meal(0)).calories).toBe(240)
    expect(Number.isFinite(mealLabelFigures(meal(0)).proteinG)).toBe(true)
  })

  it('carries the meal name through unchanged', () => {
    expect(mealLabelFigures(meal(2)).name).toBe('Ninja Creami')
  })
})

describe('fitIngredientLines', () => {
  const lineHeight = 8.5

  it('shows every ingredient when they all fit', () => {
    expect(fitIngredientLines({ room: 60, lineHeight, count: 4 })).toEqual({ shown: 4, overflow: 0 })
  })

  /**
   * The invariant the whole helper exists for, and it is NOT reachable end-to-end: the code paints a
   * white quiet-zone box before its modules, so an overrunning list is drawn over rather than
   * colliding visibly — the code still decodes, and the label just silently shows fewer ingredients
   * than it says it printed. Verified by reverting the derivation to a hardcoded five and watching
   * the full E2E suite, QR decode included, stay green.
   */
  it('never needs more lines than the room allows, including the "+N more" line', () => {
    for (const room of [10, 17, 25, 30, 42, 60]) {
      for (const count of [1, 2, 3, 5, 8, 20]) {
        const { shown, overflow } = fitIngredientLines({ room, lineHeight, count })
        const linesDrawn = shown + (overflow > 0 ? 1 : 0)
        expect(linesDrawn * lineHeight, `room ${room}, count ${count}`).toBeLessThanOrEqual(room)
        expect(shown + overflow, 'every ingredient is either shown or counted').toBe(count)
      }
    }
  })

  // Room for one line and more than one ingredient: the line goes to the summary, not to a single
  // ingredient plus a summary that will not fit. This is the case the property test caught.
  it('gives a one-line gap to the summary rather than overrunning it', () => {
    expect(fitIngredientLines({ room: 10, lineHeight, count: 2 })).toEqual({ shown: 0, overflow: 2 })
  })

  it('summarises rather than dropping — nothing vanishes silently', () => {
    const { shown, overflow } = fitIngredientLines({ room: 30, lineHeight, count: 8 })
    expect(shown + overflow).toBe(8)
    expect(overflow).toBeGreaterThan(0)
  })

  it('reports nothing to draw for a meal with no ingredients', () => {
    expect(fitIngredientLines({ room: 30, lineHeight, count: 0 })).toEqual({ shown: 0, overflow: 0 })
  })
})

describe('wrapIngredientRun', () => {
  const items = [
    { name: 'Beef mince', weightG: 200 },
    { name: 'pasta', weightG: 150 },
    { name: 'passata', weightG: 100 },
    { name: 'cheddar', weightG: 40 },
    { name: 'onion', weightG: 80 },
  ]

  it('runs the ingredients inline, comma separated', () => {
    const { lines, overflow } = wrapIngredientRun({ items, charsPerLine: 200, maxLines: 3 })
    expect(overflow).toBe(0)
    expect(lines.join(' ')).toBe('200g Beef mince, 150g pasta, 100g passata, 40g cheddar, 80g onion')
  })

  /**
   * The property Q-397's whole design rests on: inline wrapping fits the COMPLETE list in far fewer
   * lines than one-per-ingredient, which is what hands the height back to the code. Five stacked
   * ingredients are five lines; here they are three.
   */
  it('fits all five ingredients in three lines at the real column width', () => {
    const { lines, shown, overflow } = wrapIngredientRun({ items, charsPerLine: 31, maxLines: 3 })
    expect(shown).toBe(5)
    expect(overflow).toBe(0)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('never exceeds its line budget, at any width, for any list', () => {
    for (const charsPerLine of [12, 20, 31, 44]) {
      for (const maxLines of [1, 2, 3]) {
        const { lines, shown, overflow } = wrapIngredientRun({ items, charsPerLine, maxLines })
        expect(lines.length, `${charsPerLine}ch x ${maxLines}`).toBeLessThanOrEqual(maxLines)
        expect(shown + overflow, 'nothing is silently dropped').toBe(items.length)
      }
    }
  })

  it('summarises the tail as "+N more" rather than truncating a name', () => {
    const { lines, shown, overflow } = wrapIngredientRun({ items, charsPerLine: 24, maxLines: 1 })
    expect(shown + overflow).toBe(5)
    if (overflow > 0) expect(lines.join(' ')).toContain(`+${overflow} more`)
  })

  it('says how many there are when not even one fits, rather than printing half a name', () => {
    const { lines, shown } = wrapIngredientRun({ items, charsPerLine: 6, maxLines: 1 })
    expect(shown).toBe(0)
    expect(lines[0]).toBe('5 ingredients — scan')
  })

  it('returns nothing to draw for a meal with no ingredients', () => {
    expect(wrapIngredientRun({ items: [], charsPerLine: 31, maxLines: 3 }).lines).toEqual([])
  })
})

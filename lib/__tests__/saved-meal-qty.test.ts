// Extracted from `saved-meals-sheet.tsx` during Q-216, when adding the local-write fallback pushed
// that file past its 800-line limit. The size gate asks for extraction rather than trimming, and
// this was the piece worth taking out: pure arithmetic that had never been directly testable.
//
// These cases pin the behaviour as it was inside the component, so the extraction is a move and not
// a rewrite. The two null returns are the load-bearing part — they mean different things ("leave the
// row alone" vs "remove the row") and the component branches on that difference.
import { describe, it, expect } from 'vitest'
import { ingredientAmountLabel, qtyFromInput, steppedQty } from '@/components/nutrition/saved-meal-qty'

describe('qtyFromInput — typed value converted to servings', () => {
  it('passes a serving figure straight through, rounded to two decimals', () => {
    expect(qtyFromInput('1.5', 'serving', 40)).toBe(1.5)
    expect(qtyFromInput('1.239', 'serving', 40)).toBe(1.24)
  })

  it('divides grams by the serving size', () => {
    expect(qtyFromInput('100', 'g', 40)).toBe(2.5)
  })

  // Null is "leave the row alone". Returning 0 here would silently zero an ingredient the user was
  // midway through typing into.
  it('returns null for input that is not a positive number', () => {
    expect(qtyFromInput('', 'serving', 40)).toBeNull()
    expect(qtyFromInput('abc', 'serving', 40)).toBeNull()
    expect(qtyFromInput('0', 'serving', 40)).toBeNull()
    expect(qtyFromInput('-2', 'serving', 40)).toBeNull()
  })

  // The division-by-zero guard: a food with no serving size cannot be expressed in grams.
  it('returns null for grams on a food with no serving size', () => {
    expect(qtyFromInput('100', 'g', 0)).toBeNull()
    expect(qtyFromInput('100', 'g', null)).toBeNull()
    expect(qtyFromInput('100', 'g', undefined)).toBeNull()
  })

  it('caps at 100 servings', () => {
    expect(qtyFromInput('9999', 'serving', 40)).toBe(100)
  })
})

describe('steppedQty — one ± press', () => {
  it('moves by half a serving in serving mode', () => {
    expect(steppedQty(1, 'serving', 1, 40)).toBe(1.5)
    expect(steppedQty(1, 'serving', -1, 40)).toBe(0.5)
  })

  it('moves by 5 g worth in gram mode', () => {
    // 5 g against a 40 g serving is an eighth of a serving.
    expect(steppedQty(1, 'g', 1, 40)).toBe(1.13)
  })

  // Falls back to the serving step rather than dividing by zero — the same guard as above, reached
  // from the other direction.
  it('steps by half a serving in gram mode when there is no serving size', () => {
    expect(steppedQty(1, 'g', 1, 0)).toBe(1.5)
  })

  // Null is "remove the row" here, not "leave it alone" — the opposite of qtyFromInput's null, and
  // the component flatMaps on it.
  it('returns null when the step would reach zero or below', () => {
    expect(steppedQty(0.5, 'serving', -1, 40)).toBeNull()
    expect(steppedQty(0.25, 'serving', -1, 40)).toBeNull()
  })

  it('caps at 100 servings', () => {
    expect(steppedQty(100, 'serving', 1, 40)).toBe(100)
  })
})

describe('ingredientAmountLabel (BF-46 ②)', () => {
  /**
   * A serving inside a serving. The row read `8 servings · 1000 g` while the meal it belongs to is
   * measured in *portions*, so "serving" meant two different things one line apart. The owner:
   * *"just the weight would be fine for the meals. Only portions are really needed when making
   * serving sizes for the meals."*
   */
  it('says grams and nothing else when the food has a serving size', () => {
    expect(ingredientAmountLabel(125, 8)).toBe('1000 g')
    expect(ingredientAmountLabel(125, 1)).toBe('125 g')
  })

  it('says grams even for a fractional quantity — the word "serving" is what is being removed', () => {
    expect(ingredientAmountLabel(65, 0.5)).toBe('33 g')
  })

  it('falls back to servings ONLY when there is no gram equivalent to show', () => {
    expect(ingredientAmountLabel(0, 2)).toBe('2 servings')
    expect(ingredientAmountLabel(null, 1)).toBe('1 serving')
    expect(ingredientAmountLabel(undefined, 1.5)).toBe('1.5 servings')
  })
})

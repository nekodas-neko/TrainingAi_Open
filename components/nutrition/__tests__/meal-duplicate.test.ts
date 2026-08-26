import { describe, it, expect } from 'vitest'
import {
  findDuplicateMeal, normaliseMealName, DUPLICATE_MAX_FIT_DISTANCE, type ComparableMeal,
} from '../meal-duplicate'

/**
 * Duplicate detection asks, and only when it is confident (BF-11d).
 *
 * The asymmetry these tests pin: under-matching costs a duplicate the owner can delete;
 * over-matching offers to overwrite the wrong meal. BF-38's guidance for the sibling `food_items`
 * problem is the same — prefer under-merging.
 */

const totals = (proteinG: number, carbsG: number, fatG: number, calories = 0) =>
  ({ calories, proteinG, carbsG, fatG })

const LIBRARY: ComparableMeal[] = [
  { id: 'loaf', name: 'Banana Bread', totals: totals(20, 140, 25) },
  { id: 'shake', name: 'Protein Shake', totals: totals(30, 10, 5) },
]

describe('findDuplicateMeal', () => {
  it('matches the same recipe imported twice, through rounding noise', () => {
    // `perServing` rounds weights to 0.1 g, so a re-import lands fractionally off.
    const again = { name: 'Banana bread', totals: totals(20.1, 139.8, 25.05) }
    expect(findDuplicateMeal(again, LIBRARY)?.id).toBe('loaf')
  })

  it('requires the NAME too — macros alone match every shake against every other', () => {
    // Identical macros to the stored shake, different food entirely.
    const other = { name: 'Whey and milk', totals: totals(30, 10, 5) }
    expect(findDuplicateMeal(other, LIBRARY)).toBeNull()
  })

  it('requires the MACROS too — the same name at a different size is not the same meal', () => {
    // A single slice, not the loaf. Same name, ten times smaller.
    const slice = { name: 'Banana Bread', totals: totals(2, 14, 2.5) }
    expect(findDuplicateMeal(slice, LIBRARY)).toBeNull()
  })

  it('does not offer to update the meal being edited', () => {
    const itself = { name: 'Banana Bread', totals: totals(20, 140, 25) }
    expect(findDuplicateMeal(itself, LIBRARY, 'loaf')).toBeNull()
    // …but still finds it when a DIFFERENT meal is open.
    expect(findDuplicateMeal(itself, LIBRARY, 'shake')?.id).toBe('loaf')
  })

  it('an unnamed meal never matches — there is nothing to be confident about', () => {
    expect(findDuplicateMeal({ name: '   ', totals: totals(20, 140, 25) }, LIBRARY)).toBeNull()
  })

  it('sits inside the stated threshold rather than near its edge', () => {
    // 5% out on one macro alone: comfortably matched.
    const near = { name: 'Protein Shake', totals: totals(31.5, 10, 5) }
    expect(findDuplicateMeal(near, LIBRARY)?.id).toBe('shake')
    // 20% out on one macro: 0.2 > 0.15, so no offer.
    const far = { name: 'Protein Shake', totals: totals(36, 10, 5) }
    expect(findDuplicateMeal(far, LIBRARY)).toBeNull()
    expect(DUPLICATE_MAX_FIT_DISTANCE).toBe(0.15)
  })
})

describe('normaliseMealName', () => {
  it('ignores case, punctuation and spacing, which is all it ignores', () => {
    expect(normaliseMealName("Nan's  Banana-Bread!")).toBe('nans banana bread')
    expect(normaliseMealName('BANANA BREAD')).toBe(normaliseMealName('banana bread'))
    // Not fuzzy: a different flavour is a different meal, and collapsing the two would rewrite
    // the macros of every log pointing at it (BF-38).
    expect(normaliseMealName('Greek Yogurt Plain')).not.toBe(normaliseMealName('Greek Yogurt Vanilla'))
  })
})

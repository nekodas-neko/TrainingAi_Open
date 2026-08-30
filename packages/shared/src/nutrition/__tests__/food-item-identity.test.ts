// BF-38 — the create-time duplicate rule, tested against the real duplicates it was built from.
//
// The fixtures below are not invented: they are the 17 groups measured in the owner's production
// `food_items` on 2026-08-30 (221 rows, 200 distinct name+brand, 21 redundant). The valuable half
// of this file is the second describe — the pairs the rule deliberately leaves alone. A rule that
// merged those would not be a better rule, it would be a rule that silently rewrote what the owner
// ate.
import { describe, it, expect } from 'vitest'
import { foodItemIdentityKey, findDuplicateFoodItem, identityCalories } from '../food-item-identity'

const food = (
  name: string, brand: string | null, servingSizeG: number, calories: number,
  proteinG = 0, carbsG = 0, fatG = 0,
) => ({ name, brand, servingSizeG, calories, proteinG, carbsG, fatG })

describe('the same food, written twice', () => {
  // The row the owner photographed: three copies in a 24-item list.
  const macAndCheese = food('LOADED MAC & CHEESE', 'CORE POWERFOODS', 350, 672, 44, 70, 22)

  it('matches an identical row', () => {
    expect(foodItemIdentityKey(macAndCheese)).toBe(foodItemIdentityKey({ ...macAndCheese }))
  })

  it('matches through case and stray whitespace, which is how the model writes it twice', () => {
    const again = food('  loaded   mac & cheese ', ' core powerfoods', 350, 672, 44, 70, 22)
    expect(foodItemIdentityKey(again)).toBe(foodItemIdentityKey(macAndCheese))
  })

  it('treats a missing brand and an empty one as the same', () => {
    expect(foodItemIdentityKey(food('Steamed White Rice', null, 150, 195)))
      .toBe(foodItemIdentityKey({ ...food('Steamed White Rice', '', 150, 195), brand: undefined }))
  })

  it('absorbs float noise in the macros but not a real difference', () => {
    const a = food('Whey Protein Isolate', 'Bulk Nutrients', 30, 115, 25.04, 1.0, 0.5)
    expect(foodItemIdentityKey(food('Whey Protein Isolate', 'Bulk Nutrients', 30, 115, 25.02, 1.0, 0.5)))
      .toBe(foodItemIdentityKey(a))
    expect(foodItemIdentityKey(food('Whey Protein Isolate', 'Bulk Nutrients', 30, 115, 24, 1.0, 0.5)))
      .not.toBe(foodItemIdentityKey(a))
  })

  it('rounds calories the way the integer column does', () => {
    // A candidate at 672.4 has to match the 672 it was itself stored as, or the check never fires
    // for anything that went through sanitiseNutrition.
    expect(identityCalories(672.4)).toBe(672)
    expect(foodItemIdentityKey({ ...macAndCheese, calories: 672.4 })).toBe(foodItemIdentityKey(macAndCheese))
  })
})

describe('what it deliberately does NOT merge', () => {
  // Every case here is a real production group. Merging any of them changes a number the owner
  // sees, which is why the entry says prefer under-merging.

  it('leaves two servings of one food alone — the reason a density rule was rejected', () => {
    // mandarin, x4 in production: 42 kcal/80 g and 53 kcal/100 g. Identical density, and
    // food_logs stores a multiplier against the serving size — so reusing the 100 g row for an
    // 80 g entry does not lose a row, it changes what the new log means.
    const small = food('Mandarin', null, 80, 42, 0.7, 10.5, 0.2)
    const large = food('Mandarin', null, 100, 53, 0.8, 13.3, 0.3)
    expect(foodItemIdentityKey(small)).not.toBe(foodItemIdentityKey(large))
  })

  it('leaves two estimates that disagree alone, even at the same serving', () => {
    // protein bar / carman's: 137 vs 342 kcal, both at 40 g. One of those is simply wrong, and
    // merging picks a winner without telling anyone.
    expect(foodItemIdentityKey(food('Protein Bar', "Carman's", 40, 137)))
      .not.toBe(foodItemIdentityKey(food('Protein Bar', "Carman's", 40, 342)))
  })

  it('leaves a near-miss on calories alone', () => {
    // bolognese potato bake: 483 vs 528 at the same 350 g — 9% apart, which is a different estimate
    // rather than float noise.
    expect(foodItemIdentityKey(food('Bolognese Potato Bake', 'CORE POWERFOODS', 350, 483)))
      .not.toBe(foodItemIdentityKey(food('Bolognese Potato Bake', 'CORE POWERFOODS', 350, 528)))
  })

  it('does not equate a word with its symbol', () => {
    // Where a fuzzy rule starts collapsing Greek Yogurt Plain into Greek Yogurt Vanilla.
    expect(foodItemIdentityKey(food('Loaded Mac & Cheese', null, 350, 672)))
      .not.toBe(foodItemIdentityKey(food('Loaded Mac and Cheese', null, 350, 672)))
  })

  it('keeps two different brands of the same product apart', () => {
    expect(foodItemIdentityKey(food('Baked Pretzel Minis', "Parker's", 25, 101)))
      .not.toBe(foodItemIdentityKey(food('Baked Pretzel Minis', 'Coles', 25, 101)))
  })
})

describe('findDuplicateFoodItem', () => {
  const existing = [
    { id: 'a', ...food('Steamed White Rice', null, 150, 195, 4, 43, 0.4) },
    { id: 'b', ...food('Mandarin', null, 80, 42, 0.7, 10.5, 0.2) },
    { id: 'c', ...food('Mandarin', null, 100, 53, 0.8, 13.3, 0.3) },
  ]

  it('picks the one that matches, not merely the one with the same name', () => {
    expect(findDuplicateFoodItem(food('mandarin', '', 100, 53, 0.8, 13.3, 0.3), existing)?.id).toBe('c')
    expect(findDuplicateFoodItem(food('mandarin', '', 80, 42, 0.7, 10.5, 0.2), existing)?.id).toBe('b')
  })

  it('returns null rather than the closest thing it found', () => {
    expect(findDuplicateFoodItem(food('Mandarin', null, 90, 47, 0.75, 12, 0.25), existing)).toBeNull()
  })

  it('returns null on an empty candidate set, which is the ordinary first-ever create', () => {
    expect(findDuplicateFoodItem(food('Anything', null, 100, 100), [])).toBeNull()
  })

  it('returns the first match, so the survivor is the oldest row the caller ordered', () => {
    const twins = [
      { id: 'older', ...food('Ham & Cheese Wholemeal Sandwich', null, 126, 299, 18, 33, 9) },
      { id: 'newer', ...food('ham & cheese wholemeal sandwich', null, 126, 299, 18, 33, 9) },
    ]
    expect(findDuplicateFoodItem(twins[1], twins)?.id).toBe('older')
  })
})

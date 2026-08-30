// BF-57 — the self-contained label. The whole meal in the QR, so it scans for anyone, offline.
//
// The old token is a private bookmark: it carries a `saved_meals.id`, and the scan path resolves it
// against the SCANNING user's own meals, so another person's label fell to *"That saved meal no
// longer exists"*. Making ids globally resolvable was rejected — it would turn a photograph of a
// label into read access to someone's meal, on an app heading for a Play Store health-data
// declaration. So the meal travels in the code instead.
//
// Two rules carry the whole design, and both are tested here rather than described:
//
//   1. **The totals are sacred, the detail is negotiable.** An ingredient is never dropped to save
//      bytes — the tail is ROLLED into one remainder entry carrying its combined macros, so a copy's
//      figures match the original to the gram. Dropping would change the meal's calories with
//      nothing on the label to say so.
//   2. **Both formats, one decoder, indefinitely.** Labels already printed carry the 22-character
//      token and must keep working for whoever printed them.
import { describe, it, expect } from 'vitest'
import {
  encodeSharedMeal, decodeSharedMeal, decodeMealLabelScan, encodeMealLabelToken,
  qrVersionForBytes, qrModulesForVersion, QR_BYTE_CAPACITY_M, QR_V2_M_BYTE_CAPACITY,
  MEAL_SHARE_MAX_BYTES,
} from '../label-payload'
import type { SavedMeal, FoodItem } from '../../types/nutrition'

const food = (over: Partial<FoodItem> = {}): FoodItem => ({
  id: 'f', userId: 'u', name: 'Whey', servingSizeG: 100,
  calories: 120, proteinG: 25, carbsG: 2, fatG: 1,
  source: 'manual', region: 'AU', createdAt: new Date(), ...over,
})

/** A meal from `[name, brand, gramsPerServing, kcal, p, c, f]` tuples, at multiplier 1. */
function meal(name: string, servings: number, items: [string, string | null, number, number, number, number, number][]): SavedMeal {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', userId: 'u', name, servings, createdAt: new Date(),
    items: items.map(([n, brand, g, kcal, p, c, f], i) => ({
      id: `i${i}`, savedMealId: 'm', foodItemId: `f${i}`, quantityMultiplier: 1,
      foodItem: food({ id: `f${i}`, name: n, brand, servingSizeG: g, calories: kcal, proteinG: p, carbsG: c, fatG: f }),
    })),
    totals: items.reduce((a, [, , , kcal, p, c, f]) => ({
      calories: a.calories + kcal, proteinG: a.proteinG + p, carbsG: a.carbsG + c, fatG: a.fatG + f,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }),
  } as SavedMeal
}

/** The owner's real meal, the one the entry's byte measurements were taken on. */
const turkeyPasta = meal('Turkey Pasta', 2, [
  ['Turkey Mince', 'Coles', 500, 660, 115, 0, 20],
  ['Spaghetti Protein', 'BARILLA', 180, 640, 32, 116, 5],
  ['Passata', 'Mutti', 400, 140, 6, 24, 1],
])

const bigMeal = (n: number) => meal('Sunday Batch Cook', 4,
  Array.from({ length: n }, (_, i): [string, string | null, number, number, number, number, number] =>
    [`Ingredient number ${i + 1}`, 'Some Brand', 100 + i, 90 + i, 8 + i, 12 + i, 3 + i]))

const totalsOf = (ings: { weightG: number; calories: number; proteinG: number; carbsG: number; fatG: number }[]) =>
  ings.reduce((a, i) => ({
    weightG: a.weightG + i.weightG, calories: a.calories + i.calories,
    proteinG: Math.round((a.proteinG + i.proteinG) * 10) / 10,
    carbsG: Math.round((a.carbsG + i.carbsG) * 10) / 10,
    fatG: Math.round((a.fatG + i.fatG) * 10) / 10,
  }), { weightG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

describe('encodeSharedMeal', () => {
  it('round-trips a real three-ingredient meal whole', () => {
    const { text, named, rolled } = encodeSharedMeal(turkeyPasta)
    expect({ named, rolled }).toEqual({ named: 3, rolled: 0 })

    const back = decodeSharedMeal(text)!
    expect(back.name).toBe('Turkey Pasta')
    expect(back.servings).toBe(2)
    expect(back.ingredients.map(i => i.name)).toEqual([
      'Coles Turkey Mince', 'BARILLA Spaghetti Protein', 'Mutti Passata',
    ])
    expect(back.ingredients[0]).toEqual({
      name: 'Coles Turkey Mince', weightG: 500, calories: 660, proteinG: 115, carbsG: 0, fatG: 20,
    })
  })

  // The measurement the design rests on. Not a performance target — the byte count is what decides
  // the QR version, which decides millimetres per module, which decides whether a phone reads it.
  it('fits the owner’s meal inside the budget with room to spare', () => {
    const { bytes } = encodeSharedMeal(turkeyPasta)
    expect(bytes).toBeLessThanOrEqual(MEAL_SHARE_MAX_BYTES)
    expect(qrVersionForBytes(bytes)!).toBeLessThanOrEqual(11)
  })

  it('carries the WHOLE recipe plus servings, not one plate', () => {
    // A copy of a batch cook should be a batch cook. `servings` is what lets the receiving app
    // divide it, exactly as the original does.
    const back = decodeSharedMeal(encodeSharedMeal(turkeyPasta).text)!
    expect(back.servings).toBe(2)
    expect(totalsOf(back.ingredients).calories).toBe(660 + 640 + 140)
  })
})

describe('the totals are sacred (BF-57)', () => {
  it('rolls the tail rather than dropping it', () => {
    const { text, named, rolled } = encodeSharedMeal(bigMeal(12))
    expect(rolled).toBeGreaterThan(0)
    expect(named).toBeGreaterThan(0)

    const back = decodeSharedMeal(text)!
    expect(back.rolled).toBe(rolled)
    // One remainder entry, last, named so a person reading the label knows it is a group.
    expect(back.ingredients).toHaveLength(named + 1)
    expect(back.ingredients[back.ingredients.length - 1].name).toBe(`+${rolled} more`)
  })

  // The property the whole design turns on: a trimmed copy has the SAME calories and macros as the
  // original. Dropping an ingredient would silently change them, and the person scanning has no way
  // to tell.
  it.each([1, 2, 3, 5, 8, 12, 25])('keeps a %i-ingredient meal’s totals exact', (n) => {
    const original = bigMeal(n)
    const back = decodeSharedMeal(encodeSharedMeal(original).text)!

    const want = totalsOf(original.items!.map(i => ({
      weightG: i.foodItem!.servingSizeG, calories: i.foodItem!.calories,
      proteinG: i.foodItem!.proteinG, carbsG: i.foodItem!.carbsG, fatG: i.foodItem!.fatG,
    })))
    expect(totalsOf(back.ingredients)).toEqual(want)
  })

  it('never exceeds the budget, however long the meal', () => {
    for (const n of [1, 4, 10, 30, 80]) {
      const { bytes } = encodeSharedMeal(bigMeal(n))
      expect(bytes, `${n} ingredients`).toBeLessThanOrEqual(MEAL_SHARE_MAX_BYTES)
    }
  })

  // The last resort. A name long enough to blow the budget on its own must not stop the label
  // printing — the numbers are the part that cannot be guessed at, so the TITLE gives way.
  it('trims the name rather than refusing, when the name alone is over budget', () => {
    const long = meal('X'.repeat(400), 1, [['Rice', null, 100, 130, 3, 28, 1]])
    const { text, bytes } = encodeSharedMeal(long)
    expect(bytes).toBeLessThanOrEqual(MEAL_SHARE_MAX_BYTES)
    const back = decodeSharedMeal(text)!
    expect(back.name.length).toBeGreaterThan(0)
    expect(back.name.length).toBeLessThan(400)
  })

  it('handles a meal with no items at all', () => {
    const empty = meal('Nothing', 1, [])
    const back = decodeSharedMeal(encodeSharedMeal(empty).text)!
    expect(back.ingredients).toEqual([])
    expect(back.rolled).toBe(0)
  })
})

describe('rolling the tail beats truncating names', () => {
  // The comparison that chose the design. Cutting names buys one QR version and cannot rescue a long
  // recipe; rolling fits any meal at a printable size. Measured here rather than asserted in prose.
  it('a ten-ingredient meal fits version 11, which name-truncation cannot reach', () => {
    const { bytes, named, rolled } = encodeSharedMeal(bigMeal(10))
    expect(qrVersionForBytes(bytes)!).toBeLessThanOrEqual(11)
    expect(named + rolled).toBe(10)

    // The same meal with every name kept and merely shortened to 8 characters, for comparison.
    const truncated = JSON.stringify([1, 'Sunday Batch Cook', 4,
      Array.from({ length: 10 }, (_, i) => [`Ingred${i}`.slice(0, 8), 100 + i, 90 + i, 8 + i, 12 + i, 3 + i])])
    expect(qrVersionForBytes(new TextEncoder().encode(truncated).length)!).toBeGreaterThan(11)
  })
})

describe('both formats, one decoder', () => {
  it('still resolves a label printed before this existed', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(decodeMealLabelScan(encodeMealLabelToken(id))).toEqual({ kind: 'meal-id', mealId: id })
  })

  it('resolves a shared payload', () => {
    const r = decodeMealLabelScan(encodeSharedMeal(turkeyPasta).text)
    expect(r?.kind).toBe('shared-meal')
    if (r?.kind !== 'shared-meal') return
    expect(r.meal.name).toBe('Turkey Pasta')
  })

  // The shapes cannot collide, which is what makes one decoder safe: 22 base64url characters, a
  // leading `[`, and 13 digits are mutually exclusive.
  it.each(['9300601011245', '012345678905', '', 'not a code', '[', '[]', '[2,"x",1,[]]', '{"a":1}'])(
    'returns null for %j', (s) => {
      expect(decodeMealLabelScan(s)).toBeNull()
    })

  it('refuses a payload whose numbers are not numbers', () => {
    expect(decodeSharedMeal('[1,"M",1,[["Rice","100",130,3,28,1]]]')).toBeNull()
    expect(decodeSharedMeal('[1,"M",1,[["Rice",100,130,3,28]]]')).toBeNull()
    expect(decodeSharedMeal('[1,"M",1,[["Rice",100,130,3,28,null]]]')).toBeNull()
  })

  it('refuses a future format version rather than mis-parsing it', () => {
    expect(decodeSharedMeal('[2,"M",1,[["Rice",100,130,3,28,1]]]')).toBeNull()
  })
})

describe('the QR capacity table', () => {
  it('agrees with the constant the token payload was built on', () => {
    expect(QR_BYTE_CAPACITY_M[2]).toBe(QR_V2_M_BYTE_CAPACITY)
  })

  it('gives the versions the entry measured', () => {
    // 69 → v5, 167 → v9, 265 → v12, 412 → v15, 510 → v18. Independently measured before this table
    // was written, so agreement is corroboration rather than a restatement.
    expect(qrVersionForBytes(69)).toBe(5)
    expect(qrVersionForBytes(167)).toBe(9)
    expect(qrVersionForBytes(265)).toBe(12)
    expect(qrVersionForBytes(412)).toBe(15)
    expect(qrVersionForBytes(510)).toBe(18)
  })

  it('has 21 modules at version 1 and grows by four', () => {
    expect(qrModulesForVersion(1)).toBe(21)
    expect(qrModulesForVersion(11)).toBe(61)
  })

  it('gives up rather than guessing past the table', () => {
    expect(qrVersionForBytes(100_000)).toBeNull()
  })

  // Version 11 at 61 modules across ~30 mm of the 50 mm label is 0.49 mm/module — the bottom of the
  // 0.49–0.66 range this design was built to, and why the budget is 251 bytes rather than more.
  it('puts the budget at the smallest pitch the design allows', () => {
    expect(MEAL_SHARE_MAX_BYTES).toBe(QR_BYTE_CAPACITY_M[11])
    expect(30 / qrModulesForVersion(11)).toBeGreaterThanOrEqual(0.49)
    expect(30 / qrModulesForVersion(12)).toBeLessThan(0.49)
  })
})

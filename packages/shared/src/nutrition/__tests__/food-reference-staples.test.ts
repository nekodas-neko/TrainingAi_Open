// #3749 part 4. A meal's gap closed by arithmetic with table staples, or handed back to the model.
import { describe, it, expect } from 'vitest'
import {
  planStapleTopUp, mealStyle, stapleRestricted, TOP_UP_STAPLES, MAX_STAPLE_ADDITIONS, MIN_STAPLE_ADDITION_G, topUpOvershoots,
} from '../food-reference/staples'
import { referenceRowFor } from '../food-reference/resolve'
import { sumIngredients } from '../scan-totals'
import { mealFit } from '../meal-macro-fit'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

const fromTable = (name: string, weightG: number): NutritionIngredient => {
  const r = referenceRowFor(name)!
  return { name, weightG, caloriesPer100g: r.kcal, proteinPer100g: r.proteinG, carbsPer100g: r.carbsG, fatPer100g: r.fatG }
}

// Chicken and broccoli into a slot that also wants carbohydrate: nothing in the meal is a carb
// source, so resizing cannot reach it.
const savouryNoCarb = [fromTable('chicken breast, grilled', 150), fromTable('broccoli', 100), fromTable('olive oil', 10)]
const target = { calories: 600, proteinG: 45, carbsG: 60, fatG: 15 }

describe('planStapleTopUp', () => {
  it('closes a carb gap in a savoury meal with a savoury staple, by arithmetic', () => {
    const out = planStapleTopUp({ ingredients: savouryNoCarb, targets: target, restrictions: [] })
    expect(out).not.toBeNull()
    expect(out!.map(i => i.name)).toContain('white rice, cooked')
    const fit = mealFit(sumIngredients(out!), target)
    expect([fit.protein.status, fit.carbs.status, fit.fat.status]).not.toContain('under')
  })

  it('gives the addition the table\'s numbers, so it reads the same as anywhere else', () => {
    const rice = planStapleTopUp({ ingredients: savouryNoCarb, targets: target, restrictions: [] })!
      .find(i => i.name === 'white rice, cooked')!
    const row = referenceRowFor('white rice, cooked')!
    expect([rice.caloriesPer100g, rice.proteinPer100g, rice.carbsPer100g, rice.fatPer100g])
      .toEqual([row.kcal, row.proteinG, row.carbsG, row.fatG])
  })

  it('skips a staple a restriction rules out and takes the next one', () => {
    const out = planStapleTopUp({ ingredients: savouryNoCarb, targets: target, restrictions: ['Rice'] })
    expect(out?.map(i => i.name)).toContain('potatoes, boiled')
    expect(out?.map(i => i.name)).not.toContain('white rice, cooked')
  })

  it('returns null (ask the model) when every staple for the short macro is ruled out', () => {
    expect(planStapleTopUp({ ingredients: savouryNoCarb, targets: target, restrictions: ['low carb'] })).toBeNull()
  })

  it('gives a sweet meal a sweet staple, never rice', () => {
    const iceCream = [fromTable('skim milk', 250), fromTable('nonfat greek yogurt', 100)]
    const out = planStapleTopUp({ ingredients: iceCream, targets: { calories: 450, proteinG: 25, carbsG: 70, fatG: 5 }, restrictions: [] })
    expect(out).not.toBeNull()
    const added = out!.map(i => i.name).filter(n => !iceCream.some(i => i.name === n))
    expect(added.every(n => TOP_UP_STAPLES.find(s => s.name === n)?.style === 'sweet')).toBe(true)
  })

  it('returns null when the meal\'s style cannot be read', () => {
    const unknown: NutritionIngredient[] = [{ name: 'protein ice cream', weightG: 200, caloriesPer100g: 80, proteinPer100g: 12, carbsPer100g: 5, fatPer100g: 1 }]
    expect(mealStyle(unknown)).toBeNull()
    expect(planStapleTopUp({ ingredients: unknown, targets: target, restrictions: [] })).toBeNull()
    expect(mealStyle([fromTable('banana', 100), fromTable('white rice, cooked', 100)])).toBeNull()
  })

  it('returns null when the meal is not short of anything', () => {
    const fine = [fromTable('chicken breast, grilled', 150), fromTable('white rice, cooked', 200), fromTable('olive oil', 10)]
    const t = sumIngredients(fine)
    expect(planStapleTopUp({ ingredients: fine, targets: t, restrictions: [] })).toBeNull()
  })

  it('returns null when a gap is too wide for a staple\'s portion cap', () => {
    expect(planStapleTopUp({
      ingredients: savouryNoCarb, targets: { ...target, carbsG: 600, calories: 2800 }, restrictions: [],
    })).toBeNull()
  })
})

describe('stapleRestricted', () => {
  const yogurt = TOP_UP_STAPLES.find(s => s.name === 'nonfat greek yogurt')!
  it.each(['Dairy', 'dairy-free', 'Lactose intolerance', 'vegan', 'Greek yogurt'])('rules yoghurt out for "%s"', r => {
    expect(stapleRestricted(yogurt, [r])).toBe(true)
  })
  it('leaves it for an unrelated restriction', () => {
    expect(stapleRestricted(yogurt, ['shellfish', 'peanuts'])).toBe(false)
  })
  it('rules out every staple for a restriction naming it', () => {
    for (const s of TOP_UP_STAPLES) expect(stapleRestricted(s, [s.name]), s.name).toBe(true)
  })
  it('every staple is a table row, named by one of its own names', () => {
    for (const s of TOP_UP_STAPLES) expect(referenceRowFor(s.name)?.fdcId, s.name).toBe(s.fdcId)
  })
})

const addedTo = (base: readonly NutritionIngredient[], out: readonly NutritionIngredient[]) =>
  out.filter(i => !base.some(b => b.name === i.name))

describe('planStapleTopUp adds a few real ingredients, never a scatter of trace amounts', () => {
  it('names its limits', () => {
    expect(MAX_STAPLE_ADDITIONS).toBe(2)
    expect(MIN_STAPLE_ADDITION_G).toBe(15)
  })

  // Measured before the fix: salmon and spinach for a pescatarian got rice 293 g and potatoes 5 g
  // (and in a wider gap tuna and tofu as well); a 60 g banana with a protein gap got five additions
  // (yogurt 192 g, cottage cheese 4 g, almonds 15 g, chia 4 g). Fewer ingredients is a better meal.
  const scenarios: [string, NutritionIngredient[], { calories: number; proteinG: number; carbsG: number; fatG: number }, string[]][] = [
    ['salmon and spinach, pescatarian', [fromTable('salmon, cooked', 120), fromTable('spinach', 80)], { calories: 800, proteinG: 70, carbsG: 90, fatG: 30 }, ['meat', 'chicken']],
    ['a 60 g banana snack with a protein gap', [fromTable('banana', 60)], { calories: 300, proteinG: 25, carbsG: 35, fatG: 10 }, []],
    ['a 60 g banana snack, smaller target', [fromTable('banana', 60)], { calories: 250, proteinG: 20, carbsG: 30, fatG: 8 }, []],
  ]

  it.each(scenarios)('%s: at most MAX_STAPLE_ADDITIONS, each at least MIN_STAPLE_ADDITION_G, or null', (_n, ingredients, targets, restrictions) => {
    const out = planStapleTopUp({ ingredients, targets, restrictions })
    if (out === null) return   // handed to the model, which is capped at 3 and asked for fewer
    const added = addedTo(ingredients, out)
    expect(added.length).toBeLessThanOrEqual(MAX_STAPLE_ADDITIONS)
    for (const a of added) expect(Math.round(a.weightG), a.name).toBeGreaterThanOrEqual(MIN_STAPLE_ADDITION_G)
  })

  it('still closes a gap that one real staple closes', () => {
    const out = planStapleTopUp({ ingredients: savouryNoCarb, targets: target, restrictions: [] })!
    const added = addedTo(savouryNoCarb, out)
    expect(added.map(i => i.name)).toEqual(['white rice, cooked'])
    expect(added[0].weightG).toBeGreaterThanOrEqual(MIN_STAPLE_ADDITION_G)
  })

  it('holds over a grid of meals and targets: never more than the limit, never a trace amount', () => {
    const meals: NutritionIngredient[][] = [
      [fromTable('salmon, cooked', 120), fromTable('spinach', 80)],
      [fromTable('chicken breast, grilled', 150), fromTable('broccoli', 100), fromTable('olive oil', 10)],
      [fromTable('broccoli', 150), fromTable('white rice, cooked', 150)],
      [fromTable('banana', 60)],
      [fromTable('skim milk', 250), fromTable('nonfat greek yogurt', 100)],
    ]
    let produced = 0
    for (const ingredients of meals) {
      for (const [proteinG, carbsG, fatG] of [[25, 35, 10], [45, 60, 15], [60, 90, 30], [70, 40, 20], [35, 80, 12]]) {
        for (const restrictions of [[], ['meat', 'chicken'], ['vegetarian']]) {
          const targets = { calories: proteinG * 4 + carbsG * 4 + fatG * 9, proteinG, carbsG, fatG }
          const out = planStapleTopUp({ ingredients, targets, restrictions })
          if (!out) continue
          produced++
          const added = addedTo(ingredients, out)
          expect(added.length).toBeLessThanOrEqual(MAX_STAPLE_ADDITIONS)
          for (const a of added) expect(Math.round(a.weightG), a.name).toBeGreaterThanOrEqual(MIN_STAPLE_ADDITION_G)
        }
      }
    }
    expect(produced).toBeGreaterThan(0)   // the grid is not passing by returning null everywhere
  })
})

describe('planStapleTopUp does not overshoot what it did not need to add', () => {
  const broccoliAndRice = [fromTable('broccoli', 150), fromTable('white rice, cooked', 150)]

  // Measured before the fix: a vegetarian with broccoli and rice, protein short, was given 190 to
  // 219 g of tofu with olive oil on top: fat 24 to 26 g against a target of 15, calories well over.
  // Tofu is the only protein a vegetarian is offered, and it carries 9 g of fat per 100 g.
  it('returns null (ask the model) when the staple that closes protein pushes fat over target', () => {
    const targets = { calories: 400, proteinG: 40, carbsG: 50, fatG: 6 }
    expect(planStapleTopUp({ ingredients: broccoliAndRice, targets, restrictions: ['vegetarian'] })).toBeNull()
  })

  it('adds no olive oil or avocado on top of the tofu, and ends within fit tolerance of every target', () => {
    const targets = { calories: 450, proteinG: 40, carbsG: 50, fatG: 15 }
    const out = planStapleTopUp({ ingredients: broccoliAndRice, targets, restrictions: ['vegetarian'] })!
    expect(addedTo(broccoliAndRice, out).map(i => i.name)).toEqual(['firm tofu'])
    const fit = mealFit(sumIngredients(out), targets)
    expect(fit.calories.status).toBe('on')
    expect(fit.fat.status).toBe('on')
  })
})

describe('topUpOvershoots', () => {
  const t = { calories: 450, proteinG: 40, carbsG: 50, fatG: 15 }
  const fit = (over: Partial<typeof t>) => mealFit({ ...t, ...over }, t)

  it('names calories and macros that end over target beyond mealFit\'s tolerance', () => {
    expect(topUpOvershoots(fit({}), fit({ fatG: 26, calories: 540 }))).toEqual(['calories', 'fat'])
  })

  it('leaves a result within the tolerance alone', () => {
    // 10% of 15 g is under the 5 g floor: 19 g is still on target.
    expect(topUpOvershoots(fit({}), fit({ fatG: 19.5, calories: 480 }))).toEqual([])
  })

  it('does not blame the top-up for a meal that was already over by at least as much', () => {
    expect(topUpOvershoots(fit({ fatG: 30 }), fit({ fatG: 26 }))).toEqual([])
    expect(topUpOvershoots(fit({ fatG: 30 }), fit({ fatG: 30 }))).toEqual([])
  })

  it('does when the top-up made it worse', () => {
    expect(topUpOvershoots(fit({ fatG: 26 }), fit({ fatG: 30 }))).toEqual(['fat'])
  })
})

// #3749 part 4. A meal's gap closed by arithmetic with table staples, or handed back to the model.
import { describe, it, expect } from 'vitest'
import { planStapleTopUp, mealStyle, stapleRestricted, TOP_UP_STAPLES } from '../food-reference/staples'
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

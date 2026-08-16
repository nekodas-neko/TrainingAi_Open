import { describe, it, expect } from 'vitest'
import { servingSizeGrams, offProductToNutrition } from '../open-food-facts'

describe('servingSizeGrams', () => {
  it('reads a plain gram serving', () => {
    expect(servingSizeGrams('40g')).toBe(40)
    expect(servingSizeGrams('40 g')).toBe(40)
    expect(servingSizeGrams('37.5 g')).toBe(37.5)
    expect(servingSizeGrams('37,5 g')).toBe(37.5)
  })

  it('reads grams out of a described serving', () => {
    expect(servingSizeGrams('1 bar (40g)')).toBe(40)
    expect(servingSizeGrams('2 biscuits - 30 grams')).toBe(30)
  })

  it('treats a millilitre serving as the same number of grams', () => {
    expect(servingSizeGrams('250 ml')).toBe(250)
    expect(servingSizeGrams('1 glass (200ml)')).toBe(200)
  })

  // The regression this parser was tightened for: the "g" of "glass" used to match, so the serving
  // became one gram and every macro read a hundredth of its real value.
  it('does not read a unit out of a word that merely starts with it', () => {
    expect(servingSizeGrams('1 glass')).toBe(100)
    expect(servingSizeGrams('1 mug')).toBe(100)
    expect(servingSizeGrams('1 portion')).toBe(100)
  })

  it('falls back to 100 g when there is nothing to read', () => {
    expect(servingSizeGrams(undefined)).toBe(100)
    expect(servingSizeGrams('')).toBe(100)
  })
})

describe('offProductToNutrition', () => {
  it('prefers the per-serving figures when OFF supplies them', () => {
    const r = offProductToNutrition({
      product_name: 'Quaker Oats', brands: 'Quaker', serving_size: '40 g',
      nutriments: {
        'energy-kcal_serving': 150, 'energy-kcal_100g': 375,
        'proteins_serving': 5, 'carbohydrates_serving': 27, 'fat_serving': 3,
      },
    })
    expect(r).not.toBeNull()
    expect(r!.calories).toBe(150)
    expect(r!.proteinG).toBe(5)
    expect(r!.servingSizeG).toBe(40)
  })

  it('scales the per-100 g figures when there are no per-serving ones', () => {
    const r = offProductToNutrition({
      product_name: 'Rice', serving_size: '50 g',
      nutriments: { 'energy-kcal_100g': 360, 'proteins_100g': 7, 'carbohydrates_100g': 80, 'fat_100g': 1 },
    })
    expect(r!.calories).toBe(180)
    expect(r!.proteinG).toBe(3.5)
    expect(r!.carbsG).toBe(40)
  })

  // A zero-calorie ingredient poisons every total it lands in, and OFF is full of name-only entries.
  it('rejects a product with no usable energy value', () => {
    expect(offProductToNutrition({ product_name: 'Mystery', nutriments: {} })).toBeNull()
    expect(offProductToNutrition({ product_name: 'Mystery' })).toBeNull()
  })
})

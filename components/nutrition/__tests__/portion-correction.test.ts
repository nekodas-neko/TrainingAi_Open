import { describe, expect, it } from 'vitest'
import { correctedServingG, parsePortionCorrection } from '../portion-correction'

describe('parsePortionCorrection — the quantities it answers locally', () => {
  it.each([
    ['300g', 300],
    ['300 g', 300],
    ['300grams', 300],
    ['300 grams', 300],
    ['250 gm', 250],
    ['it was 300g', 300],
    ["it's 300 g", 300],
    ['actually 180g', 180],
    ['make it 125g', 125],
    ['change to 125 g', 125],
    ['change it to 125 g', 125],
    ['should be 90g', 90],
    ['I had 300g', 300],
    ['about 300g', 300],
    ['~300g', 300],
    ['actually it was about 300g', 300],
    ['300g please', 300],
    ['300g.', 300],
    ['0.5kg', 500],
    ['1 kilo', 1000],
    ['2kgs', 2000],
    ['  It Was   300 G  ', 300],
  ])('%s → %d g', (text, grams) => {
    expect(parsePortionCorrection(text)).toEqual({ kind: 'grams', grams })
  })

  it.each([
    ['2 servings', 2],
    ['2servings', 2],
    ['1.5 serves', 1.5],
    ['it was 3 portions', 3],
    ['make it 2 serving', 2],
  ])('%s → %s servings', (text, servings) => {
    expect(parsePortionCorrection(text)).toEqual({ kind: 'servings', servings })
  })
})

describe('parsePortionCorrection — everything it must hand to the model', () => {
  it.each([
    // A bare number has no unit, and guessing one rescales macros from an assumption.
    ['300', 'a unit-less number'],
    ['it was 300', 'a unit-less number behind a lead-in'],
    // Grams is what the row stores; ml→g is a density this app does not know.
    ['300ml', 'millilitres'],
    ['1 cup', 'a volume'],
    ['2 slices', 'a count with no gram weight'],
    // A second clause means the correction is not only about the portion.
    ['300g and it was fried', 'a portion plus a preparation change'],
    ['it was chicken thigh not breast', 'an identity correction'],
    ['add the sauce', 'an ingredient correction'],
    ['double it', 'a multiplier with no quantity'],
    ['half', 'a fraction with no unit'],
    ['', 'an empty correction'],
    ['   ', 'whitespace'],
    // Bounds: past these, a typo is likelier than a portion.
    ['0g', 'zero grams'],
    ['-50g', 'a negative weight'],
    ['50kg', 'fifty kilograms of food'],
    ['999 servings', 'an absurd serving count'],
  ])('%s is left to the model (%s)', text => {
    expect(parsePortionCorrection(text)).toBeNull()
  })
})

describe('correctedServingG', () => {
  it('takes grams as given, whatever the base', () => {
    expect(correctedServingG({ kind: 'grams', grams: 300 }, 150)).toBe(300)
    expect(correctedServingG({ kind: 'grams', grams: 300 }, null)).toBe(300)
  })

  it('multiplies a serving count by the base serving', () => {
    expect(correctedServingG({ kind: 'servings', servings: 2 }, 150)).toBe(300)
    expect(correctedServingG({ kind: 'servings', servings: 1.5 }, 100)).toBe(150)
  })

  it('refuses a serving count with no base to multiply — that is a model question', () => {
    expect(correctedServingG({ kind: 'servings', servings: 2 }, null)).toBeNull()
    expect(correctedServingG({ kind: 'servings', servings: 2 }, 0)).toBeNull()
  })

  it('refuses a serving count that resolves past the gram ceiling', () => {
    expect(correctedServingG({ kind: 'servings', servings: 40 }, 800)).toBeNull()
  })
})

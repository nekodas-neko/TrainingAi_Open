import { describe, expect, it } from 'vitest'
import { describeSearchPhrase, nameMatchesPhrase } from '../describe-search-phrase'

describe('describeSearchPhrase — descriptions that name one food', () => {
  it.each([
    ['chicken breast', 'chicken breast'],
    ['Chicken Breast', 'chicken breast'],
    ['  chicken breast  ', 'chicken breast'],
    ['200g chicken breast', 'chicken breast'],
    ['200 g chicken breast', 'chicken breast'],
    ['250ml milk', 'milk'],
    ['2 cups of oats', 'oats'],
    ['1 slice sourdough', 'sourdough'],
    ['3 x weetbix', 'weetbix'],
    // The alternation-order trap: every plural unit must be consumed whole, or its trailing "s"
    // survives into the phrase and matches nothing.
    ['2 slices bread', 'bread'],
    ['3 scoops whey', 'whey'],
    ['2 servings lasagne', 'lasagne'],
    ['4 pieces sushi', 'sushi'],
    ['2 tablespoons peanut butter', 'peanut butter'],
    ['2 chicken breasts', 'chicken breasts'],
    ['some greek yoghurt', 'greek yoghurt'],
    ['a banana', 'banana'],
    ['the protein shake', 'protein shake'],
    ['my overnight oats', 'overnight oats'],
    ['chicken breast.', 'chicken breast'],
    // " with " is not a separator: it is how saved meals are named.
    ['chicken with rice', 'chicken with rice'],
    // Interior punctuation survives, because the stored name carries it.
    ["ben's protein bar", "ben's protein bar"],
    ['peri-peri chicken', 'peri-peri chicken'],
  ])('%s → %s', (text, phrase) => {
    expect(describeSearchPhrase(text)).toBe(phrase)
  })
})

describe('describeSearchPhrase — descriptions with nothing to look up', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['ab', 'shorter than a name'],
    ['200g', 'a quantity and no food'],
    // A composite is not a row in food_items, and a partial match for one would be misleading.
    ['chicken, rice and broccoli', 'a comma-separated list'],
    ['chicken and rice', 'an "and" list'],
    ['eggs + toast', 'a "+" list'],
    ['steak plus salad', 'a "plus" list'],
    ['200g chicken breast with white rice and broccoli', 'the entry\'s own example'],
    ['a big bowl of leftover spaghetti bolognese', 'prose longer than a name'],
  ])('%s yields no lookup (%s)', text => {
    expect(describeSearchPhrase(text)).toBeNull()
  })
})

describe('nameMatchesPhrase', () => {
  it('matches the stored name case-insensitively, as a substring', () => {
    expect(nameMatchesPhrase('Chicken Breast, Raw', 'chicken breast')).toBe(true)
    expect(nameMatchesPhrase('Grilled chicken breast', 'chicken breast')).toBe(true)
  })

  it('does not match a different food', () => {
    expect(nameMatchesPhrase('Chicken Thigh', 'chicken breast')).toBe(false)
  })
})

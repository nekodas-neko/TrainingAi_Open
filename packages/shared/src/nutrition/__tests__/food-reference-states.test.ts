// #3749 review. The rule that keeps a food whose numbers depend on how it was prepared from ever
// answering to a bare name, checked over the whole generated table instead of a hand-picked list.
//
// Why it exists: bare "oats" pointed at DRY oats (379 kcal per 100 g). A bowl of porridge weighed
// cooked is about a fifth of that, so the same words overstated the meal five times over. Rice and
// chicken breast were already refused a bare name; oats, double cream, coconut milk, plain yoghurt
// and toast were pinned to one state or the wrong product without anyone deciding to.
import { describe, it, expect } from 'vitest'
import { FDC_SR_LEGACY_ROWS } from '../food-reference/fdc-sr-legacy'
import { referenceRowFor } from '../food-reference/resolve'
import {
  STATE_DEPENDENT_FOOD_KEYS, isStateDependentFoodName,
} from '../food-reference/state-dependent'
import type { FoodReferenceRow } from '../food-reference/types'

// Words that say how a food was prepared, in a name or in a USDA description.
const STATE_WORDS = new Set([
  'raw', 'dry', 'dried', 'uncooked', 'cooked', 'boiled', 'hard-boiled', 'canned', 'tinned', 'drained',
  'roasted', 'grilled', 'broiled', 'baked', 'steamed', 'fried', 'pan-fried', 'scrambled', 'poached',
  'sauteed', 'sautéed', 'wilted', 'unprepared', 'frozen',
])
const CONNECTORS = new Set(['with', 'in', 'made', 'water'])

const tokens = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ-]+/).filter(Boolean)
const hasStateWord = (s: string) => tokens(s).some(t => STATE_WORDS.has(t))
/** The food a stated name is a state of: "oats (cooked with water)" -> "oats". */
const baseOf = (name: string) => tokens(name).filter(t => !STATE_WORDS.has(t) && !CONNECTORS.has(t)).join(' ')
const containsWords = (name: string, phrase: string) => ` ${tokens(name).join(' ')} `.includes(` ${tokens(phrase).join(' ')} `)

/**
 * Two states of one food that differ by no more than this are the same food for a bare name:
 * cooking moves broccoli from 34 to 35 kcal per 100 g, mushrooms from 22 to 28. The same width the
 * table's own energy sanity check uses (15 kcal or 25%, whichever is wider).
 */
const STATE_SPREAD_KCAL = 15
const STATE_SPREAD_FRACTION = 0.25
const wide = (a: FoodReferenceRow, b: FoodReferenceRow) =>
  Math.abs(a.kcal - b.kcal) > Math.max(STATE_SPREAD_KCAL, Math.max(a.kcal, b.kcal) * STATE_SPREAD_FRACTION)

/**
 * Bare names deliberately kept on a state-specific row, with the reason. Recipes weigh eggs raw, in
 * the shell-less weight the person typed, and the fat an egg is fried in is its own ingredient, so
 * "egg" means the raw row even though fried egg (196 kcal) is a different number.
 */
const KEPT_BARE = new Map<number, string>([[171287, 'recipes weigh eggs raw; frying fat is its own ingredient']])

const keptNames = new Set(FDC_SR_LEGACY_ROWS.filter(r => KEPT_BARE.has(r.fdcId)).flatMap(r => r.names.filter(n => !hasStateWord(n))))

const stateRows = FDC_SR_LEGACY_ROWS.filter(r => hasStateWord(r.description))
const bareNames = (r: FoodReferenceRow) => r.names.filter(n => !hasStateWord(n))
/** Other rows holding a stated name that contains one of this row's bare names, as whole words. */
const siblingsOf = (r: FoodReferenceRow) => FDC_SR_LEGACY_ROWS.filter(s => s !== r
  && s.names.some(n => hasStateWord(n) && bareNames(r).some(b => containsWords(n, b))))

describe('the generated table and state-dependent foods', () => {
  it('gives no bare name to a state-specific row of a food that exists in other states, when the states differ', () => {
    const offenders = stateRows
      .filter(r => bareNames(r).length > 0 && !KEPT_BARE.has(r.fdcId))
      .filter(r => siblingsOf(r).some(s => wide(r, s)))
      .map(r => `${r.description.slice(0, 50)}: ${bareNames(r).join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('keeps egg on the raw whole egg row, as decided', () => {
    for (const n of ['egg', 'eggs']) expect(referenceRowFor(n)?.fdcId, n).toBe(171287)
    expect(KEPT_BARE.get(171287)).toMatch(/raw/)
  })

  it.each([
    'oats', 'rolled oats', 'quick oats', 'porridge oats',   // dry; a bowl is weighed cooked
    'double cream',                                          // about a third richer than heavy whipping cream
    'coconut milk',                                          // canned and a drink are different foods
    'plain yoghurt', 'natural yoghurt', 'plain yogurt', 'natural yogurt', // Greek-style plain has twice the protein
    'white toast', 'wholemeal toast',                        // the row is untoasted bread
  ])('has no bare name "%s"', name => {
    expect(referenceRowFor(name), name).toBeNull()
  })

  it.each([
    'rolled oats, dry', 'oats (dry)', 'oats, cooked with water', 'canned coconut milk', 'coconut milk, canned',
    'whole milk yogurt', 'whole milk yoghurt', 'white bread', 'wholemeal bread', 'heavy cream',
  ])('still resolves the name that says which "%s"', name => {
    expect(referenceRowFor(name), name).not.toBeNull()
  })
})

describe('STATE_DEPENDENT_FOOD_KEYS', () => {
  it('is folded, unique and never answered by the table', () => {
    expect(new Set(STATE_DEPENDENT_FOOD_KEYS).size).toBe(STATE_DEPENDENT_FOOD_KEYS.length)
    for (const k of STATE_DEPENDENT_FOOD_KEYS) {
      expect(k, k).toBe(k.trim().toLowerCase().replace(/\s+/g, ' '))
      expect(referenceRowFor(k), k).toBeNull()
    }
  })

  it('names every food the table holds in states that differ', () => {
    const missing = new Set<string>()
    for (const r of FDC_SR_LEGACY_ROWS) {
      if (KEPT_BARE.has(r.fdcId)) continue
      const bases = new Set(r.names.filter(hasStateWord).map(baseOf).filter(Boolean))
      for (const s of FDC_SR_LEGACY_ROWS) {
        if (s === r || KEPT_BARE.has(s.fdcId) || !wide(r, s)) continue
        for (const b of s.names.filter(hasStateWord).map(baseOf)) {
          if (bases.has(b) && !keptNames.has(b) && !STATE_DEPENDENT_FOOD_KEYS.includes(b)) missing.add(b)
        }
      }
    }
    expect([...missing].sort()).toEqual([])
  })

  it('covers the names a person writes for foods that change with preparation', () => {
    for (const k of ['rice', 'pasta', 'oats', 'lentils', 'beans', 'quinoa', 'couscous', 'noodles', 'chicken breast', 'mince']) {
      expect(isStateDependentFoodName(k), k).toBe(true)
    }
  })

  it('matches a whole folded name only', () => {
    expect(isStateDependentFoodName('  RICE ')).toBe(true)
    expect(isStateDependentFoodName('Rice Krispies')).toBe(false)
    expect(isStateDependentFoodName('white rice, cooked')).toBe(false)
    expect(isStateDependentFoodName('')).toBe(false)
  })
})

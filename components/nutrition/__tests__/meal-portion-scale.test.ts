import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MEAL_SCALES, scaleToNumber, type MealScale } from '../meal-portion-scale'

/**
 * BF-104 — logging a saved meal at ½× / 1× / 1½×.
 *
 * The owner: *"when logging food/meals we should be able to choose how much of the meal; i.e full at
 * 1x or 1.5 or 0.5 etc."* LB-49 put the argument through `logMealItems`; this is the surface that
 * sets it, and what these cases guard is the two ways a portion picker goes wrong: the number never
 * reaching the write, and the sheet's own figures not following the choice.
 */

const ROOT = path.resolve(__dirname, '../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the scales themselves', () => {
  it('are the three the owner named, and nothing else', () => {
    expect(MEAL_SCALES.map(s => s.value)).toEqual(['0.5', '1', '1.5'])
  })

  it.each([['0.5', 0.5], ['1', 1], ['1.5', 1.5]])('%s parses to %s', (value, expected) => {
    expect(scaleToNumber(value as MealScale)).toBe(expected)
  })

  it('is a discrete control, never a free-number field', () => {
    // The entry is explicit: "Whatever the picker is, it must not be a free-number field." A
    // keyboard for a value that is almost always one of three is the worse control, and it cannot
    // be driven one-handed while holding a plate.
    const src = source('components/nutrition/meal-portion-picker.tsx')
    expect(src).toContain('SegmentedTabs')
    expect(src).not.toMatch(/<input/)
    expect(src).not.toMatch(/type="number"/)
  })
})

describe('the number reaches the write', () => {
  it('the detail sheet hands the factor to onLog', () => {
    expect(source('components/nutrition/meal-detail-sheet.tsx')).toContain('onLog(shown, factor)')
  })

  it('the library sheet threads it into logMealItems', () => {
    // LB-49's argument is the last positional one. Passing anything short of it silently logs one
    // portion, which is the failure this whole entry exists to remove.
    expect(source('components/nutrition/saved-meals-sheet.tsx'))
      .toContain('logMealItems(meal, targetDate, mealTypeId, userId, tz, scale)')
  })

  it('the row\'s one-tap log still defaults to a whole portion', () => {
    // Byte-identical to before for every caller that does not choose. A default of anything else
    // would rewrite what every existing quick-log writes.
    expect(source('components/nutrition/saved-meals-sheet.tsx')).toMatch(/quickLog = useCallback\(async \(meal: SavedMeal, scale = 1\)/)
  })
})

describe('the sheet does not lie about what the button writes', () => {
  it('the headline and macro figures are derived from the chosen factor', () => {
    // This sheet's own note says those figures are "per portion — that is what `Log this meal`
    // writes". Once the button can write 1.5 portions, a figure fixed at one stops describing the
    // button, which is the two-numbers-for-one-thing class LA-45 and BF-99 each closed.
    const src = source('components/nutrition/meal-detail-sheet.tsx')
    expect(src).toMatch(/calories: onePortion\.calories \* factor/)
    expect(src).toMatch(/proteinG: onePortion\.proteinG \* factor/)
    expect(src).toMatch(/carbsG: onePortion\.carbsG \* factor/)
    expect(src).toMatch(/fatG: onePortion\.fatG \* factor/)
  })

  it('and the label under the headline says which portion it is showing', () => {
    expect(source('components/nutrition/meal-detail-sheet.tsx')).toMatch(/factor === 1 \? 'per portion'/)
  })

  it('resets to a whole portion when a different meal opens', () => {
    // A portion is a fact about one sitting. A sheet that opened on the last choice would log half
    // a meal silently the next time it is used without looking.
    const src = source('components/nutrition/meal-detail-sheet.tsx')
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(meal\) setScale\('1'\) \}, \[meal\?\.id\]\)/)
  })
})

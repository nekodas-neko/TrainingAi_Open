// LA-131: the rest-day rule was declared twice — once in the meal-plan generate route, once in the
// restructure route for the same plan. The risk was never that either copy was wrong; they agreed.
// It was that tuning one would silently re-target every rest-day meal on a restructure against a
// different definition of a rest day, with both numbers still looking plausible.
//
// So the load-bearing case here is the EQUIVALENCE one: the helper reproduces the arithmetic that
// was deleted from both routes, exactly, across a range of inputs. The rest pin the rule itself.
import { describe, it, expect } from 'vitest'
import { macrosForDayType, REST_DAY_CARB_REDUCTION, type DayMacros } from '../rest-day-macros'

/** The code that stood in BOTH routes before this change, transcribed rather than imported. */
function inlineAsItWas(daily: DayMacros, dayType: 'all' | 'training' | 'rest') {
  const carbShift = dayType === 'rest' ? Math.round(daily.carbsG * 0.15) : 0
  return {
    calories: daily.calories - carbShift * 4,
    proteinG: daily.proteinG,
    carbsG: daily.carbsG - carbShift,
    fatG: daily.fatG,
  }
}

describe('macrosForDayType (LA-131)', () => {
  it('holds protein and fat, and moves only carbohydrate', () => {
    const out = macrosForDayType({ calories: 2400, proteinG: 180, carbsG: 200, fatG: 80 }, 'rest')
    expect(out.carbShiftG).toBe(30)
    expect(out.carbsG).toBe(170)
    expect(out.proteinG).toBe(180)
    expect(out.fatG).toBe(80)
  })

  it('removes the carbohydrate calories too, at 4 kcal/g', () => {
    const out = macrosForDayType({ calories: 2400, proteinG: 180, carbsG: 200, fatG: 80 }, 'rest')
    expect(out.calories).toBe(2400 - 30 * 4)
  })

  it.each(['training', 'all'] as const)('leaves a %s day untouched', dayType => {
    const daily = { calories: 2400, proteinG: 180, carbsG: 200, fatG: 80 }
    const out = macrosForDayType(daily, dayType)
    expect(out.carbShiftG).toBe(0)
    expect(out).toMatchObject(daily)
  })

  it('rounds the shift to whole grams rather than carrying a fraction into the calories', () => {
    // 173 × 0.15 = 25.95 → 26, so calories move by 104 and not by 103.8.
    const out = macrosForDayType({ calories: 2000, proteinG: 150, carbsG: 173, fatG: 70 }, 'rest')
    expect(out.carbShiftG).toBe(26)
    expect(out.carbsG).toBe(147)
    expect(out.calories).toBe(2000 - 104)
    expect(Number.isInteger(out.calories)).toBe(true)
  })

  it('states the reduction as one exported constant', () => {
    expect(REST_DAY_CARB_REDUCTION).toBe(0.15)
  })

  // The regression guard. If someone changes the helper's arithmetic, this fails against the copy
  // the routes used to carry — which is the only way to know a "refactor" stayed a refactor.
  it('matches the inline arithmetic both routes carried, across a range of inputs', () => {
    for (let carbs = 0; carbs <= 400; carbs++) {
      const daily = { calories: 1200 + carbs * 5, proteinG: 150, carbsG: carbs, fatG: 70 }
      for (const dayType of ['all', 'training', 'rest'] as const) {
        const got = macrosForDayType(daily, dayType)
        expect({
          calories: got.calories, proteinG: got.proteinG, carbsG: got.carbsG, fatG: got.fatG,
        }).toEqual(inlineAsItWas(daily, dayType))
      }
    }
  })
})

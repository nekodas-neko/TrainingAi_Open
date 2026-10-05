// BF-203a. Which plan meals are owed an estimate, and at what macros.
import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { dueForEstimate, slotCloseHour, estimateSlotsFor, type EstimateSlot } from '../meal-estimate'

const slot = (id: string, closeHour: number, kcal: number, mealTypeId = `mt-${id}`): EstimateSlot => ({
  planMealId: id, mealTypeId, closeHour,
  targetCalories: kcal, targetProteinG: 30, targetCarbsG: 40, targetFatG: 10,
})
const none = new Set<string>()

describe('dueForEstimate', () => {
  it('estimates a slot that is over with nothing logged and nothing answered', () => {
    expect(dueForEstimate({ slots: [slot('a', 11, 400)], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 12, biasKcal: 0 }))
      .toEqual([{ planMealId: 'a', calories: 400, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 0 }])
  })

  it('does not estimate a slot that is not over yet', () => {
    expect(dueForEstimate({ slots: [slot('a', 11, 400)], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 10.9, biasKcal: 0 })).toEqual([])
  })

  it('does not estimate a slot whose meal type has food logged', () => {
    expect(dueForEstimate({ slots: [slot('a', 11, 400)], loggedMealTypeIds: new Set(['mt-a']), answeredPlanMealIds: none, localHour: 12, biasKcal: 0 })).toEqual([])
  })

  it('does not estimate a slot that was declined or already estimated', () => {
    expect(dueForEstimate({ slots: [slot('a', 11, 400)], loggedMealTypeIds: none, answeredPlanMealIds: new Set(['a']), localHour: 12, biasKcal: 0 })).toEqual([])
  })

  // The double count the design exists to prevent: one logged lunch must not leave a second lunch
  // slot to be estimated on top of it.
  it('lets one logged meal satisfy every slot that shares its type', () => {
    const slots = [slot('a', 13, 400, 'lunch'), slot('b', 14, 300, 'lunch'), slot('c', 11, 200, 'snack')]
    const out = dueForEstimate({ slots, loggedMealTypeIds: new Set(['lunch']), answeredPlanMealIds: none, localHour: 15, biasKcal: 0 })
    expect(out.map(o => o.planMealId)).toEqual(['c'])
  })

  it('applies the bias per slot, in proportion to the slot calories', () => {
    const out = dueForEstimate({ slots: [slot('a', 11, 400), slot('b', 15, 600)], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 16, biasKcal: 200 })
    expect(out.map(o => o.calories)).toEqual([480, 720])
  })

  it('never returns a negative calorie estimate', () => {
    const out = dueForEstimate({ slots: [slot('a', 11, 300)], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 12, biasKcal: -5000 })
    expect(out[0].calories).toBe(0)
  })
})

describe('slotCloseHour', () => {
  it('closes at the type end when the suggested time is inside the window', () => {
    expect(slotCloseHour(12, '10:30')).toBe(12)
  })

  // The owner's 16:20 meal is typed Lunch (12-15) by the nearest-window rule. Closing at 15 would
  // estimate it before it was due.
  it('waits an hour past a suggested time that lies after the type end', () => {
    expect(slotCloseHour(15, '16:20')).toBeCloseTo(17 + 20 / 60)
  })

  it('uses whichever of the two it has, and gives up with neither', () => {
    expect(slotCloseHour(null, '07:00')).toBe(8)
    expect(slotCloseHour(21, null)).toBe(21)
    expect(slotCloseHour(null, 'soon')).toBeNull()
    expect(slotCloseHour(undefined, undefined)).toBeNull()
  })
})

// The caller must resolve the hour in the user's zone. A fixed-offset zone makes the case fire on
// every run rather than only in one band of UTC hours.
describe('estimate window boundary, user-local', () => {
  const TZ = 'Etc/GMT-10' // UTC+10
  const hourIn = (iso: string) => {
    const [h, m] = formatInTimeZone(new Date(iso), TZ, 'H:m').split(':').map(Number)
    return h + m / 60
  }
  const dinner = slot('dinner', 21, 700)

  it('is over at 23:59 local', () => {
    const h = hourIn('2026-09-26T13:59:00Z')
    expect(Math.floor(h)).toBe(23)
    expect(dueForEstimate({ slots: [dinner], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: h, biasKcal: 0 })).toHaveLength(1)
  })

  it('is not over at 00:01 local, which is a new day', () => {
    const h = hourIn('2026-09-26T14:01:00Z')
    expect(Math.floor(h)).toBe(0)
    expect(dueForEstimate({ slots: [dinner], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: h, biasKcal: 0 })).toHaveLength(0)
  })

  it('treats the close hour itself as over', () => {
    expect(dueForEstimate({ slots: [dinner], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 21, biasKcal: 0 })).toHaveLength(1)
  })
})

describe('estimateSlotsFor (Task 8′)', () => {
  const types = [
    { id: 'lunch', timeStartHour: 12, timeEndHour: 15 },
    { id: 'dinner', timeStartHour: 18, timeEndHour: 21 },
  ] as unknown as Parameters<typeof estimateSlotsFor>[1]
  const meal = (id: string, mealTypeId: string | null, suggestedTime: string | null) => ({
    id, mealTypeId, suggestedTime, targetCalories: 500, targetProteinG: 30, targetCarbsG: 50, targetFatG: 15,
  })

  it('types an untagged meal by its time and closes it after that time', () => {
    const [s] = estimateSlotsFor([meal('m1', null, '16:20')], types)
    expect(s.mealTypeId).toBe('lunch')
    expect(s.closeHour).toBeCloseTo(17 + 20 / 60)
  })

  it('keeps an explicit tag and uses that type\'s end', () => {
    const [s] = estimateSlotsFor([meal('m2', 'dinner', null)], types)
    expect(s).toMatchObject({ mealTypeId: 'dinner', closeHour: 21 })
  })

  it('leaves out a meal it cannot place in time', () => {
    expect(estimateSlotsFor([meal('m3', null, null)], types)).toEqual([])
  })
})

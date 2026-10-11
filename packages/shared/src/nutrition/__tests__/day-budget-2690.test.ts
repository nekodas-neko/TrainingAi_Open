// Issue 2690. `calorieBudgetsByDay` rebuilds the budget each past day would have shown. These pin the
// per-day rules that the database test cannot reach cheaply: which weigh-in, which measured RMR and
// which own target a day reads.
import { describe, it, expect } from 'vitest'
import { calorieBudgetsByDay, type PastDayBudgetInput } from '../day-budget'
import { calorieBudget } from '../calorie-budget'
import { mifflinStJeorBmr } from '../goal-recommendation'
import { stepEnergyKcal, STEP_BASE_CREDIT } from '../../health/daily-energy'

const base: PastDayBudgetInput = {
  days: ['2026-09-10'],
  tz: 'Australia/Brisbane',
  metrics: [{ date: '2026-09-10', weightKg: 80 }],
  bodyFatCalibration: null,
  measuredRmrs: [],
  heightCm: 180,
  dateOfBirth: '1990-01-01',
  sex: 'male',
  goal: 'maintain',
  targetWeightKg: null,
  ownTargetKcal: null,
  workouts: [],
  avgBpmBySession: new Map(),
  activities: [],
}
const on = (patch: Partial<PastDayBudgetInput>, day = '2026-09-10') =>
  calorieBudgetsByDay({ ...base, ...patch }).get(day)

describe('calorieBudgetsByDay (#2690)', () => {
  it('builds the budget from the one formula', () => {
    const profile = { ageYears: 36, weightKg: 80, sex: 'male' as const }
    expect(on({})).toBe(calorieBudget({
      rmrKcal: Math.round(mifflinStJeorBmr(80, 180, 36, 'male')),
      deficitKcal: 0,
      movementKcal: 0,
      stepCreditKcal: stepEnergyKcal(profile, STEP_BASE_CREDIT),
    }).totalKcal)
  })

  it('has no budget for a day with no weigh-in in its window', () => {
    expect(on({ days: ['2026-06-01'] }, '2026-06-01')).toBeNull()
  })

  it('reads a weigh-in from later than the day never', () => {
    expect(on({ days: ['2026-09-09'] }, '2026-09-09')).toBeNull()
  })

  it('uses a measured RMR only from the day it was measured', () => {
    const rmr = { measuredOn: '2026-09-10', rmrKcal: 2200, ffmKgAtTest: null }
    const before = calorieBudgetsByDay({
      ...base, days: ['2026-09-10', '2026-09-11'],
      metrics: [{ date: '2026-09-10', weightKg: 80 }, { date: '2026-09-11', weightKg: 80 }],
      measuredRmrs: [{ ...rmr, measuredOn: '2026-09-11' }],
    })
    expect(before.get('2026-09-10')).toBe(on({}))
    expect(before.get('2026-09-11')).toBeGreaterThan(on({})! + 300)
  })

  it('is the own target when one is set', () => {
    expect(on({ ownTargetKcal: 2345 })).toBe(2345)
  })

  it('grows with that day\'s movement only', () => {
    const days = ['2026-09-10', '2026-09-11']
    const metrics = [{ date: '2026-09-10', weightKg: 80 }, { date: '2026-09-11', weightKg: 80 }]
    const out = calorieBudgetsByDay({
      ...base, days, metrics,
      activities: [{ date: '2026-09-11', activityType: 'run', durationMin: 60 }],
    })
    expect(out.get('2026-09-10')).toBe(on({}))
    expect(out.get('2026-09-11')).toBeGreaterThan(out.get('2026-09-10')! + 200)
  })
})

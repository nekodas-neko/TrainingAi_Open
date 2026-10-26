// #3347 — scoreActivityForDay must pick the newest weigh-in whatever order the repository returns
// rows in. Postgres `listBodyMetrics` is newest first; an `.reverse().find` took the oldest (#2926).
import { describe, it, expect } from 'vitest'
import { scoreActivityForDay, type ActivityDayInput } from '../activity-day'
import { getDailyGoals } from '../daily-goals'

const DAY = '2026-10-08'
const row = (date: string, weightKg: number) => ({ date, weightKg })
const NEWEST_FIRST = [row(DAY, 90), row('2026-10-01', 95), row('2026-09-20', 100)]

const input = (bodyMetrics: ActivityDayInput['bodyMetrics']): ActivityDayInput => ({
  date: DAY,
  tz: 'Australia/Brisbane',
  bodyMetrics,
  restingHrBaseline: null,
  hrRows: [],
  maxHr: null,
  sessions: [],
  program: null,
  user: { heightCm: 180, sex: 'male', activityLevel: 'moderate', dateOfBirth: '1990-01-01' },
  stepsGoal: null,
})

describe('scoreActivityForDay weight pick (#3347)', () => {
  it('rows newest first use today\'s weigh-in, not the oldest in the window', () => {
    const expected = getDailyGoals({ weightKg: 90, heightCm: 180, ageYears: 36, sex: 'male', activityLevel: 'moderate', stepsGoal: null })
    const oldest = getDailyGoals({ weightKg: 100, heightCm: 180, ageYears: 36, sex: 'male', activityLevel: 'moderate', stepsGoal: null })
    expect(expected.activeEnergyGoal).not.toBe(oldest.activeEnergyGoal)
    expect(scoreActivityForDay(input(NEWEST_FIRST)).goals.activeEnergyGoal).toBe(expected.activeEnergyGoal)
  })

  it('ascending rows give the same goals', () => {
    const asc = [...NEWEST_FIRST].reverse()
    expect(scoreActivityForDay(input(asc)).goals).toEqual(scoreActivityForDay(input(NEWEST_FIRST)).goals)
  })
})

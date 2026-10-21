// #2926 — the goals' weight was `[...rows].reverse().find(weight > 0)`, which is the latest only when
// rows arrive oldest first. Postgres `listBodyMetrics` returns them newest first, so production scaled
// the active-energy goal from the OLDEST weigh-in in the 28-day window. The picker reads dates now.
import { describe, it, expect } from 'vitest'
import { latestWeightKg } from '../latest-weight'
import { getDailyGoals, DEFAULT_ACTIVE_ENERGY_GOAL } from '../daily-goals'

const row = (date: string, weightKg?: number | null) => ({ date, weightKg })
const DAY = '2026-03-28'
const ASC = [row('2026-03-01', 84), row('2026-03-10', null), row('2026-03-14', 82.5), row('2026-03-27', 81)]
const DESC = [...ASC].reverse()

describe('latestWeightKg (#2926)', () => {
  it('rows newest first (the Postgres order) give the newest weigh-in', () => {
    expect(latestWeightKg(DESC, DAY)).toBe(81)
    // The expression this replaced, on the same rows, returned the oldest weigh-in.
    expect([...DESC].reverse().find(m => m.weightKg != null && m.weightKg > 0)?.weightKg).toBe(84)
  })

  it('rows oldest first give the same answer', () => {
    expect(latestWeightKg(ASC, DAY)).toBe(81)
    const shuffled = [ASC[2], ASC[0], ASC[3], ASC[1]]
    expect(latestWeightKg(shuffled, DAY)).toBe(81)
  })

  it('skips a missing or non-positive weight on a newer row', () => {
    expect(latestWeightKg([row('2026-03-27', 0), row('2026-03-26', null), row('2026-03-20', 80)], DAY)).toBe(80)
  })

  it('ignores a weigh-in after the day it is asked about', () => {
    expect(latestWeightKg([row('2026-03-29', 79), row('2026-03-27', 81)], DAY)).toBe(81)
    expect(latestWeightKg([row('2026-03-28', 80)], DAY)).toBe(80)
  })

  it('no weight in the window gives null, and the goals fall back exactly as before', () => {
    expect(latestWeightKg([], DAY)).toBeNull()
    expect(latestWeightKg([row('2026-03-27', null), row('2026-03-26')], DAY)).toBeNull()
    const goals = getDailyGoals({ weightKg: latestWeightKg([], DAY), heightCm: 180, ageYears: 36, sex: 'male', activityLevel: null })
    expect(goals.activeEnergyGoal).toBe(DEFAULT_ACTIVE_ENERGY_GOAL)
  })

  it('two weigh-ins on one date: the first in the input wins', () => {
    // `body_metrics` is unique on (user_id, date), so a repository read cannot tie; only a hand-merged
    // array can. Strict `>` keeps the first seen, the same rule `latestRestingHrRow` uses.
    expect(latestWeightKg([row('2026-03-27', 81), row('2026-03-27', 82)], DAY)).toBe(81)
    expect(latestWeightKg([row('2026-03-27', 82), row('2026-03-27', 81)], DAY)).toBe(82)
  })

  it('moves the active-energy goal by 2.4 kcal per kg (10 kcal/kg of BMR × 0.24)', () => {
    const goal = (weightKg: number) =>
      getDailyGoals({ weightKg, heightCm: 180, ageYears: 36, sex: 'male', activityLevel: null }).activeEnergyGoal
    expect(goal(90) - goal(80)).toBe(24)
  })
})

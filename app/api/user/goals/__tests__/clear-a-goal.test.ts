// Found while implementing Q-241, not filed by it: a goal could be set but never cleared.
//
// `PATCH /api/user/goals` mapped every field through `?? undefined`, which collapses "clear this
// one" and "leave this one alone" into the same instruction. The request returned 200 and the value
// stayed, so the failure was silent.
//
// It hid because the Health tab read the water / target-weight / target-body-fat goals from
// `localStorage`, where clearing *did* appear to work. That is the same two-copies-disagreeing root
// Q-241 fixes — and making the server authoritative is precisely what would have turned this latent
// bug into a visible "my cleared goal came back on the next load".
//
// The test has to go through the route: `updateUserGoals` already drew the distinction correctly
// (skip on `undefined`, write on `null`), so a test calling the repository directly passes both
// before and after the fix and proves nothing. The mapping in front of it is the whole defect.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TEST_USER_ID = 'user-goals-1'

const authMock = vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } }))
const updateUserGoals = vi.fn(async () => {})
const getUserGoals = vi.fn(async () => ({ calorieGoalType: 'daily' as const }))
const upsertNutritionTargets = vi.fn(async () => {})

vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ updateUserGoals, getUserGoals, upsertNutritionTargets }),
}))

import { PATCH } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/user/goals', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/user/goals — clearing a goal reaches the database', () => {
  beforeEach(() => { updateUserGoals.mockClear() })

  it('forwards an explicit null instead of dropping it', async () => {
    const res = await PATCH(req({ targetWeightKg: null }))
    expect(res.status).toBe(200)
    expect(updateUserGoals).toHaveBeenCalledWith(TEST_USER_ID, { targetWeightKg: null })
  })

  // The property the old mapping was presumably protecting, which the fix must not lose: the client
  // PATCHes only the field the user touched, so an absent key has to stay absent rather than
  // becoming an explicit null and wiping a goal nobody edited.
  it('does not invent keys the request left out', async () => {
    await PATCH(req({ stepsGoal: 9000 }))
    expect(updateUserGoals).toHaveBeenCalledWith(TEST_USER_ID, { stepsGoal: 9000 })
  })

  it('clears each numeric goal', async () => {
    for (const field of ['stepsGoal', 'sleepGoalHours', 'calorieGoal',
      'waterGoalMl', 'targetWeightKg', 'targetBfPct'] as const) {
      updateUserGoals.mockClear()
      await PATCH(req({ [field]: null }))
      expect(updateUserGoals).toHaveBeenCalledWith(TEST_USER_ID, { [field]: null })
    }
  })

  // A null calorie goal must not be mirrored into nutrition_targets as a 0 kcal target — the
  // mirror exists to stop the two drifting, and `goalToDailyKcal(null)` is not a target.
  it('does not mirror a cleared calorie goal into nutrition targets', async () => {
    upsertNutritionTargets.mockClear()
    await PATCH(req({ calorieGoal: null }))
    expect(upsertNutritionTargets).not.toHaveBeenCalled()
  })
})

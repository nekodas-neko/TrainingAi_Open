// Issue 2622 — the own calorie target travels as `calorie_goal` + `calorie_goal_type = 'own'`.
// The route refuses a flag with no number, or a number outside what a person could eat, and does not
// mirror an own target into `nutrition_targets.calories` (that row feeds the macro split, not the budget).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TEST_USER_ID = 'user-goals-2622'

const authMock = vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } }))
const updateUserGoals = vi.fn(async () => {})
const getUserGoals = vi.fn(async () => ({ calorieGoalType: 'daily' as string | null }))
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

describe('PATCH /api/user/goals — own calorie target', () => {
  beforeEach(() => {
    updateUserGoals.mockClear()
    upsertNutritionTargets.mockClear()
    getUserGoals.mockResolvedValue({ calorieGoalType: 'daily' })
  })

  it('stores the number and the flag together, and does not mirror it into the macro targets', async () => {
    const res = await PATCH(req({ calorieGoal: 1800, calorieGoalType: 'own' }))
    expect(res.status).toBe(200)
    expect(updateUserGoals).toHaveBeenCalledWith(TEST_USER_ID, { calorieGoal: 1800, calorieGoalType: 'own' })
    expect(upsertNutritionTargets).not.toHaveBeenCalled()
  })

  it('clears with the pair of nulls', async () => {
    const res = await PATCH(req({ calorieGoal: null, calorieGoalType: null }))
    expect(res.status).toBe(200)
    expect(updateUserGoals).toHaveBeenCalledWith(TEST_USER_ID, { calorieGoal: null, calorieGoalType: null })
  })

  it('refuses the flag with no number', async () => {
    const res = await PATCH(req({ calorieGoalType: 'own' }))
    expect(res.status).toBe(400)
    expect(updateUserGoals).not.toHaveBeenCalled()
  })

  it.each([799, 10_001, 0, 1800.5])('refuses an implausible own target (%s) with a message', async kcal => {
    const res = await PATCH(req({ calorieGoal: kcal, calorieGoalType: 'own' }))
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    expect(updateUserGoals).not.toHaveBeenCalled()
  })

  it('accepts the bounds themselves', async () => {
    expect((await PATCH(req({ calorieGoal: 800, calorieGoalType: 'own' }))).status).toBe(200)
    expect((await PATCH(req({ calorieGoal: 10_000, calorieGoalType: 'own' }))).status).toBe(200)
  })

  it('a bare number under an existing own target is held to the same bounds', async () => {
    getUserGoals.mockResolvedValue({ calorieGoalType: 'own' })
    const res = await PATCH(req({ calorieGoal: 50 }))
    expect(res.status).toBe(400)
    expect(updateUserGoals).not.toHaveBeenCalled()
  })

  it('a typed goal that is not an own target is still mirrored, as before', async () => {
    await PATCH(req({ calorieGoal: 2400 }))
    expect(upsertNutritionTargets).toHaveBeenCalledWith(TEST_USER_ID, { calories: 2400 })
  })
})

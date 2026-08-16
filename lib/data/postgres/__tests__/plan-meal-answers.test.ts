// Q-187 phase 2 — the "I did not eat this" half of the prefill.
//
// This file exists for the three things that would be silently catastrophic rather than merely
// wrong:
//
//   1. **Ownership.** `meal_plan_meals` carries no `user_id`, so the write is only safe if it joins
//      back to `meal_plans` — two levels up. A missing join lets one user record answers against
//      another user's plan, and no type checker can catch it.
//   2. **The tombstone.** Undo is a soft delete. If the delta hid soft-deleted rows, the undo would
//      never reach a second device and the meal would stay declined there forever.
//   3. **Re-declining after an undo.** The unique index is partial on `deleted_at IS NULL`, so a
//      soft-deleted row is invisible to the conflict target. Without the revive path that is either
//      a duplicate row or a lost decline, depending on which way the insert falls.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-000000018701'
const USER_B = '00000000-0000-4000-8000-000000018702'
const DATE = '2026-08-14'

describe.skipIf(!canRun)('plan meal answers — ownership, tombstone, re-decline', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let mealA = ''
  let mealB = ''

  const planInput = (name: string) => ({
    name, mealsPerDay: 2,
    targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
    activate: false,
    variants: [{
      dayType: 'all' as const,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      meals: [
        { position: 0, name: 'Breakfast', targetCalories: 900, targetProteinG: 75, targetCarbsG: 90, targetFatG: 30 },
        { position: 1, name: 'Dinner', targetCalories: 900, targetProteinG: 75, targetCarbsG: 90, targetFatG: 30 },
      ],
    }],
  })

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, email] of [[USER_A, 'pma-a'], [USER_B, 'pma-b']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `${email}@example.com`])
    }
    const planA = await repo.createMealPlan(USER_A, planInput('A'))
    const planB = await repo.createMealPlan(USER_B, planInput('B'))
    mealA = planA.variants[0].meals[0].id
    mealB = planB.variants[0].meals[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER_A, USER_B]) {
      await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [id])
      await pool.query('DELETE FROM meal_plans WHERE user_id = $1', [id])
      await pool.query('DELETE FROM users WHERE id = $1', [id])
    }
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = ANY($1)', [[USER_A, USER_B]])
  })

  it('records a decline and reads it back for the day', async () => {
    const saved = await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(saved).not.toBeNull()
    expect(saved!.answer).toBe('no')
    const list = await repo.listPlanMealAnswers(USER_A, DATE)
    expect(list.map(a => a.planMealId)).toEqual([mealA])
  })

  // The two-level join. Without it, A records an answer against B's meal.
  it("refuses another user's plan meal", async () => {
    const saved = await repo.savePlanMealAnswer(USER_A, { planMealId: mealB, logDate: DATE })
    expect(saved).toBeNull()
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM plan_meal_answers WHERE plan_meal_id = $1', [mealB])
    expect(rows[0].n).toBe(0)
  })

  it('scopes the read to the day, not just the user', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(await repo.listPlanMealAnswers(USER_A, '2026-08-15')).toEqual([])
  })

  it('undo soft-deletes rather than removing the row', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(await repo.deletePlanMealAnswer(USER_A, mealA, DATE)).toBe(true)
    expect(await repo.listPlanMealAnswers(USER_A, DATE)).toEqual([])
    // Still present, so `getSyncDelta` can carry the reversal to a device that has not synced.
    const { rows } = await pool.query(
      'SELECT deleted_at FROM plan_meal_answers WHERE user_id = $1 AND plan_meal_id = $2', [USER_A, mealA])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
  })

  it("will not undo another user's answer", async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(await repo.deletePlanMealAnswer(USER_B, mealA, DATE)).toBe(false)
    expect(await repo.listPlanMealAnswers(USER_A, DATE)).toHaveLength(1)
  })

  // The partial-index path: the soft-deleted row is invisible to the conflict target, so the insert
  // finds nothing to conflict with. Revived explicitly, or the decline is lost.
  it('re-declining after an undo revives the row instead of duplicating it', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    await repo.deletePlanMealAnswer(USER_A, mealA, DATE)
    const again = await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(again).not.toBeNull()
    expect(await repo.listPlanMealAnswers(USER_A, DATE)).toHaveLength(1)
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM plan_meal_answers WHERE user_id = $1 AND plan_meal_id = $2', [USER_A, mealA])
    expect(rows[0].n).toBe(1)
  })

  it('declining twice is idempotent', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    expect(await repo.listPlanMealAnswers(USER_A, DATE)).toHaveLength(1)
  })

  // The tombstone channel. A delta that filtered `deleted_at` could never tell a device the answer
  // went away, so the undo would not propagate — the exact failure the sync rules exist to prevent.
  it('the sync delta carries a soft-deleted answer', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    await repo.deletePlanMealAnswer(USER_A, mealA, DATE)
    const delta = await repo.getSyncDelta(USER_A, new Date(Date.now() - 60_000))
    const answers = (delta.planMealAnswers ?? []) as { planMealId: string; deletedAt: string | null }[]
    const row = answers.find(a => a.planMealId === mealA)
    expect(row).toBeDefined()
    expect(row!.deletedAt).not.toBeNull()
  })

  it('the sync delta is scoped to the user', async () => {
    await repo.savePlanMealAnswer(USER_A, { planMealId: mealA, logDate: DATE })
    const delta = await repo.getSyncDelta(USER_B, new Date(Date.now() - 60_000))
    const answers = (delta.planMealAnswers ?? []) as { planMealId: string }[]
    expect(answers.find(a => a.planMealId === mealA)).toBeUndefined()
  })
})

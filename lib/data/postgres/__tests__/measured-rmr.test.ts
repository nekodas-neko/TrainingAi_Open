// BF-33 — a clinically measured RMR had nowhere to go, so every resting rate the app used was
// predicted. The entry's own verification bar is not "it stores": it is that the goal MOVES, i.e.
// `calculateBaseline` returns a different calorie target with a measurement present than without.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { calculateBaseline } from '@trainingai/shared/nutrition/goal-recommendation'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b6f33'
const OTHER = '00000000-0000-4000-8000-0000000b6f34'

describe.skipIf(!canRun)('measured RMR — storage, scoping, and effect on the goal (BF-33)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    for (const id of [USER, OTHER]) {
      // Email derived from the id — a hardcoded one left behind after a rename fails
      // `users_email_unique` under the new id (LA-32).
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `measured-rmr-${id}@example.com`])
    }
  })

  afterAll(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [id])
    }
  })

  it('stores a test and reads it back whole', async () => {
    await repo.saveMeasuredRmr(USER, {
      measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2, weightKgAtTest: 71.4,
      method: 'indirect calorimetry', provider: 'ScanCo', notes: 'fasted',
    })
    expect(await repo.getLatestMeasuredRmr(USER)).toEqual({
      measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2, weightKgAtTest: 71.4,
      method: 'indirect calorimetry', provider: 'ScanCo', notes: 'fasted',
    })
  })

  // THE POINT OF ITS OWN TABLE. A second test must not overwrite the first — two measurements at
  // different body compositions are how you learn whether the first still describes this person.
  it('a later test sits BESIDE the first, and the latest is what reads back', async () => {
    await repo.saveMeasuredRmr(USER, { measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2 })
    await repo.saveMeasuredRmr(USER, { measuredOn: '2027-03-01', rmrKcal: 1810, ffmKgAtTest: 58.0 })
    const all = await repo.listMeasuredRmr(USER)
    expect(all.map(t => t.measuredOn)).toEqual(['2027-03-01', '2026-09-01'])
    expect((await repo.getLatestMeasuredRmr(USER))!.rmrKcal).toBe(1810)
  })

  it('re-entering the SAME date corrects it rather than adding a duplicate', async () => {
    await repo.saveMeasuredRmr(USER, { measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2 })
    await repo.saveMeasuredRmr(USER, { measuredOn: '2026-09-01', rmrKcal: 1741, ffmKgAtTest: 55.2 })
    const all = await repo.listMeasuredRmr(USER)
    expect(all).toHaveLength(1)
    expect(all[0].rmrKcal).toBe(1741)
  })

  it('is scoped to its user', async () => {
    await repo.saveMeasuredRmr(USER, { measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2 })
    expect(await repo.getLatestMeasuredRmr(OTHER)).toBeNull()
    expect(await repo.listMeasuredRmr(OTHER)).toEqual([])
  })

  // The entry's stated bar: prove the goal actually moves.
  it('changes the calorie target — the measurement is not merely stored', async () => {
    const input = {
      weightKg: 71.4, heightCm: 178, ageYears: 34, sex: 'male',
      activityLevel: 'moderate' as never, fitnessGoal: 'maintain' as never, bodyFatPct: 22.7,
    }
    const predicted = calculateBaseline(input)

    await repo.saveMeasuredRmr(USER, { measuredOn: '2026-09-01', rmrKcal: 1714, ffmKgAtTest: 55.2 })
    const test = (await repo.getLatestMeasuredRmr(USER))!
    const withMeasured = calculateBaseline({
      ...input,
      measuredRmr: { rmrKcal: test.rmrKcal, ffmKgAtTest: test.ffmKgAtTest },
    })

    expect(withMeasured.bmr).not.toBe(predicted.bmr)
    expect(withMeasured.calories).not.toBe(predicted.calories)
    // The owner's real sheet reads +13% measured over predicted, so the target must move UP.
    expect(withMeasured.bmr).toBeGreaterThan(predicted.bmr)
  })
})

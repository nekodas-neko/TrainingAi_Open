// LB-42 — `weight_goal_kg` and `target_weight_kg` were two columns for one goal, filled from two
// screens. The Edit Profile sheet wrote one; the Health page renders the other; the nutrition-goal
// recommendation prompt quoted the first as *"goal weight"*. So the number the user saw as their
// goal and the number the AI was told was their goal could differ, with nothing reconciling them.
//
// These pin the resolution end-to-end through the repository, because the whole defect lived in
// which column each path touched — a unit test on either path alone would have passed throughout.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000lb42'.replace('lb42', '0042')

describe.skipIf(!canRun)('one weight goal, one column (LB-42)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'one-weight-goal@example.com'],
    )
  })

  beforeEach(async () => {
    await pool.query(`UPDATE users SET weight_goal_kg = NULL, target_weight_kg = NULL WHERE id = $1`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function columns() {
    const { rows: [r] } = await pool.query<{ w: string | null; t: string | null }>(
      `SELECT weight_goal_kg AS w, target_weight_kg AS t FROM users WHERE id = $1`, [USER])
    return { weightGoalKg: r.w == null ? null : Number(r.w), targetWeightKg: r.t == null ? null : Number(r.t) }
  }

  it('the profile editor writes the column the Health page reads, and not the retired one', async () => {
    await repo.updateUserProfile(USER, { weightGoalKg: 74 })
    expect(await columns()).toEqual({ weightGoalKg: null, targetWeightKg: 74 })
  })

  // The two editors are the bug. Whichever one the user reaches, the other must show the same
  // number back — that is the whole claim, and it is only observable across both paths.
  it('the goals editor and the profile editor now see each other', async () => {
    await repo.updateUserGoals(USER, { targetWeightKg: 68 })
    expect((await repo.getUserById(USER))?.weightGoalKg).toBe(68)

    await repo.updateUserProfile(USER, { weightGoalKg: 66 })
    expect((await repo.getUserGoals(USER)).targetWeightKg).toBe(66)
  })

  // BF-78's presence guard has to survive the repoint: a PATCH that names no weight goal must not
  // clear one. This is the failure mode that PR existed to close, on a field that just moved.
  it('a body that omits the goal leaves it alone', async () => {
    await repo.updateUserGoals(USER, { targetWeightKg: 71 })
    await repo.updateUserProfile(USER, { displayName: 'Someone' })
    expect((await repo.getUserGoals(USER)).targetWeightKg).toBe(71)
  })

  it('but an explicit null still clears it', async () => {
    await repo.updateUserGoals(USER, { targetWeightKg: 71 })
    await repo.updateUserProfile(USER, { weightGoalKg: null })
    expect((await repo.getUserGoals(USER)).targetWeightKg).toBeNull()
  })

  // Migration 246's shape, exercised rather than read. Filling only NULLs is what stops a value the
  // user cannot see overwriting one they can — and where both exist and disagree, the visible one
  // has to stand.
  describe('migration 246 back-fills without overwriting', () => {
    const BACKFILL = `UPDATE users SET target_weight_kg = weight_goal_kg
                       WHERE target_weight_kg IS NULL AND weight_goal_kg IS NOT NULL AND id = $1`

    it('fills an empty target from the retired column', async () => {
      await pool.query(`UPDATE users SET weight_goal_kg = 80 WHERE id = $1`, [USER])
      await pool.query(BACKFILL, [USER])
      expect((await columns()).targetWeightKg).toBe(80)
    })

    it('leaves a disagreeing target alone — the visible number wins', async () => {
      await pool.query(`UPDATE users SET weight_goal_kg = 80, target_weight_kg = 72 WHERE id = $1`, [USER])
      await pool.query(BACKFILL, [USER])
      expect((await columns()).targetWeightKg).toBe(72)
    })

    it('is idempotent — a second run matches nothing', async () => {
      await pool.query(`UPDATE users SET weight_goal_kg = 80 WHERE id = $1`, [USER])
      await pool.query(BACKFILL, [USER])
      const after = await pool.query(BACKFILL, [USER])
      expect(after.rowCount).toBe(0)
      expect((await columns()).targetWeightKg).toBe(80)
    })
  })
})

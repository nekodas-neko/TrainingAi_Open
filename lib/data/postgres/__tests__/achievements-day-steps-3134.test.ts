// #3134. The "steps in a day" ladder reads the day step count the screens show: the device total plus
// a treadmill session's steps. An outdoor walk's steps are already inside the device total, so they
// are not added, and a deleted session adds nothing.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-000000003134'

describe.skipIf(!canRun)('the steps ladder reads the day step count (#3134)', () => {
  let pool: import('pg').Pool
  let compute: typeof import('@/lib/achievements').computeAchievements
  const today = todayInTz(TZ)

  const best = async () => (await compute(USER, TZ)).achievements.find(a => a.id === 'steps_10k')?.current
  const logActivity = (type: string, steps: number) => pool.query(
    `INSERT INTO activity_logs (user_id, date, activity_type, title, steps) VALUES ($1, $2, $3, $3, $4)`,
    [USER, today, type, steps])

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    compute = (await import('@/lib/achievements')).computeAchievements
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'ach-3134@example.com','x',$2)`, [USER, TZ])
    await pool.query(`INSERT INTO body_metrics (user_id, date, steps) VALUES ($1, $2, 8000)`, [USER, today])
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it("adds a treadmill session's steps to that day, and not an outdoor walk's", async () => {
    expect(await best()).toBe(8000)
    await logActivity('walk', 4000)
    expect(await best()).toBe(8000)
    await logActivity('treadmill', 3000)
    expect(await best()).toBe(11000)
  })

  it('counts nothing for a deleted treadmill session', async () => {
    await pool.query(`UPDATE activity_logs SET deleted_at = now() WHERE user_id = $1`, [USER])
    expect(await best()).toBe(8000)
  })

  it('counts a treadmill-only day', async () => {
    await pool.query(`UPDATE body_metrics SET steps = NULL WHERE user_id = $1`, [USER])
    await logActivity('treadmill', 12000)
    expect(await best()).toBe(12000)
  })
})

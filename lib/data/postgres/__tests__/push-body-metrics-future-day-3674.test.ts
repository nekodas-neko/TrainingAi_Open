// #3674 item 1: the future-day guard sat only on `POST /api/body-metadata`, and both apps write
// manual weights through `/api/sync/push`. A phone with its clock set ahead filed the weigh-in under
// a future day, and that row then won every "most recent weight" read for good (Q-494).
//
// #3673 item 1 rides along: a write that fails in Drizzle reports `String(err)`, which ends with the
// mutation's bound values. That string goes back to the device and into `error_events`.
//
// Dates are computed from the user's today, never hardcoded on one side of the window.
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-000000003674'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('body_metrics on the push path refuses a day after tomorrow (#3674)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const push = (date: string, payload: Record<string, unknown>) =>
    repo.pushMutations(U, [{ id: `m-${date}`, domain: 'body_metrics', date, payload }])
  const rowCount = async (date: string) =>
    (await pool.query('SELECT count(*)::int AS n FROM body_metrics WHERE user_id=$1 AND date=$2', [U, date])).rows[0].n as number

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query('DELETE FROM users WHERE id = $1', [U])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
      [U, `future-day-${U.slice(-4)}@example.com`, TZ])
  })
  afterAll(async () => { if (canRun) await pool.query('DELETE FROM users WHERE id = $1', [U]) })

  it('accepts today and tomorrow (the midnight tolerance the POST route allows)', async () => {
    const today = todayInTz(TZ)
    for (const date of [today, shiftDateStr(today, 1)]) {
      const r = await push(date, { weightKg: 80 })
      expect(r.errors, date).toEqual([])
      expect(r.processed, date).toBe(1)
      expect(await rowCount(date), date).toBe(1)
    }
  })

  it('refuses a weigh-in dated after tomorrow, writes nothing, and does not ask for a retry', async () => {
    const date = shiftDateStr(todayInTz(TZ), 2)
    const r = await push(date, { weightKg: 80 })
    expect(r.processed).toBe(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].error).toMatch(/dated after/)
    expect(r.errors[0].retryable).toBeUndefined()
    expect(await rowCount(date)).toBe(0)
  })

  it('refuses a far-future day and a water delta on a future day the same way', async () => {
    for (const [date, payload] of [['9999-12-30', { weightKg: 80 }], [shiftDateStr(todayInTz(TZ), 5), { waterMlDelta: 250 }]] as const) {
      const r = await push(date, payload)
      expect(r.errors, date).toHaveLength(1)
      expect(await rowCount(date), date).toBe(0)
    }
  })

  it('a failed write reports its error without the mutation\'s bound values (#3673)', async () => {
    // A user that does not exist: the insert fails on the foreign key inside Drizzle, whose
    // message ends with `params: <the row's values>`.
    const ghost = '00000000-0000-4000-8000-00000000367f'
    const r = await repo.pushMutations(ghost, [{ id: 'g1', domain: 'body_metrics', date: todayInTz(TZ), payload: { weightKg: 81.37 } }])
    expect(r.errors).toHaveLength(1)
    const msg = r.errors[0].error
    expect(msg).toContain('Failed query')
    expect(msg).toContain('params: [scrubbed]')
    expect(msg).not.toContain('81.37')
    expect(msg).not.toContain(ghost)
  })
})

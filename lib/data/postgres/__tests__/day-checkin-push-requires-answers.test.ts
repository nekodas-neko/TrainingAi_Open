// The sync-push mirror for Q-465. The web route refuses a check-in that says nothing; the outbox
// reaches the same table through `pushMutations`, and a guard on one path only is how the two
// write paths drift — the failure mode this repo has hit in three domains.
//
// The rejection is per-item and NOT retryable: a mutation carrying no information will never carry
// any, so retrying it forever is the poison-pill shape the outbox exists to avoid.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000d465'
const DAY = '2026-07-09'

describe.skipIf(!canRun)('day_checkins push — a check-in has to say something', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const rows = async () => {
    const { rows } = await pool.query(`SELECT * FROM day_checkins WHERE user_id = $1`, [USER])
    return rows
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `checkin-answers-${USER}@example.com`])
  })

  afterAll(async () => { await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER]) })
  beforeEach(async () => { await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER]) })

  const push = (payload: Record<string, unknown>, id = 'm-1') =>
    repo.pushMutations(USER, [{ id, domain: 'day_checkins', date: DAY, payload }])

  it('rejects an answerless payload per-item and writes nothing', async () => {
    const res = await push({ phase: 'evening' })
    expect(await rows()).toHaveLength(0)
    expect(res.errors?.some(e => e.error === 'Day check-in carries no answers')).toBe(true)
  })

  it('does not mark it retryable — it will never carry information', async () => {
    const res = await push({ phase: 'evening' })
    const err = res.errors?.find(e => e.error === 'Day check-in carries no answers')
    expect(err?.retryable).not.toBe(true)
  })

  it('does not strand the siblings behind it', async () => {
    // One poison mutation must never block the queue — three production incidents say so. The
    // rejected one is reported by id and the one behind it still lands.
    const res = await repo.pushMutations(USER, [
      { id: 'bad-1', domain: 'day_checkins', date: DAY, payload: { phase: 'evening' } },
      { id: 'good-1', domain: 'day_checkins', date: DAY, payload: { phase: 'evening', hydration: 4 } },
    ])
    expect(res.errors.map(e => e.id)).toEqual(['bad-1'])
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0].hydration).toBe(4)
  })

  it('accepts a payload with a single answer', async () => {
    await push({ phase: 'evening', hydration: 4 })
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0].hydration).toBe(4)
  })
})

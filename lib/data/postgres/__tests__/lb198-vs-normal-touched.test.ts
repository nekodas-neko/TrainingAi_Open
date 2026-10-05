// LB-198. `vs_normal_touched` records whether the owner tapped the picker, because LB-191 seeds the
// neutral and an untouched Save is otherwise indistinguishable from a considered "about the same".
// NULL means UNKNOWN and is what a client that does not say gets: never defaulted to false, never
// inferred from Save.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resolveVsAnswer } from '@trainingai/shared/validation/day-checkin'

describe('resolveVsAnswer — the touched flag (LB-198)', () => {
  it('carries the flag as sent, and reports UNKNOWN when the client did not say', () => {
    expect(resolveVsAnswer({ vsNormal: 'same', vsNormalTouched: false })).toMatchObject({ vsNormalTouched: false })
    expect(resolveVsAnswer({ vsNormal: 'better', vsNormalTouched: true })).toMatchObject({ vsNormalTouched: true })
    expect(resolveVsAnswer({ vsNormal: 'same' })).toMatchObject({ vsNormalTouched: null })
    expect(resolveVsAnswer({ vsNormal: 'same', vsNormalTouched: null })).toMatchObject({ vsNormalTouched: null })
  })
  it('has no flag without an answer, and none for a legacy-key mutation', () => {
    expect(resolveVsAnswer({ vsNormal: null, vsNormalTouched: true }).vsNormalTouched).toBeNull()
    expect(resolveVsAnswer({ vsYesterday: 'worse', vsNormalTouched: true }).vsNormalTouched).toBeNull()
  })
})

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b1980'
const DAY = '2026-10-05'

describe.skipIf(!canRun)('day_checkins.vs_normal_touched (LB-198)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const row = async () => (await pool.query(`SELECT vs_normal, vs_normal_touched FROM day_checkins WHERE user_id = $1`, [USER])).rows[0]
  const push = (payload: Record<string, unknown>) =>
    repo.pushMutations(USER, [{ id: 'm-lb198', domain: 'day_checkins', date: DAY, payload: { phase: 'morning', ...payload } }])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `lb198-${USER}@example.com`])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(async () => { await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER]) })

  it('stores an untouched seed as false and a tap as true', async () => {
    await push({ vsNormal: 'same', vsQuestion: 2, vsNormalTouched: false })
    expect(await row()).toEqual({ vs_normal: 'same', vs_normal_touched: false })
    await push({ vsNormal: 'better', vsQuestion: 2, vsNormalTouched: true })
    expect(await row()).toEqual({ vs_normal: 'better', vs_normal_touched: true })
  })

  it('stores UNKNOWN, not false, when the client says nothing, and for a legacy-key mutation', async () => {
    await push({ vsNormal: 'same', vsQuestion: 2 })
    expect(await row()).toEqual({ vs_normal: 'same', vs_normal_touched: null })
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER])
    await push({ vsYesterday: 'worse' })
    expect(await row()).toEqual({ vs_normal: 'worse', vs_normal_touched: null })
  })

  it('reads the flag back through the repository', async () => {
    await push({ vsNormal: 'same', vsQuestion: 2, vsNormalTouched: false })
    expect(await repo.getDayCheckin(USER, DAY, 'morning')).toMatchObject({ vsNormal: 'same', vsNormalTouched: false })
  })

  it('refuses a flag with no answer', async () => {
    await expect(pool.query(
      `INSERT INTO day_checkins (user_id, log_date, phase, vs_normal_touched) VALUES ($1, $2, 'morning', true)`, [USER, DAY],
    )).rejects.toThrow(/day_checkins_vs_touched_check/)
  })
})

// #3982 against a real Postgres: a rated day is never turned into a dismissal, whatever order the
// answers arrive in. Skips without DATABASE_URL; the statement itself is checked in
// `readiness-verdict-answer-order-sql-3982.test.ts`, which CI runs.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003982'
const DAY = '2026-11-21'

describe.skipIf(!canRun)('readiness verdict answers keep their order (#3982)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const seed = async () => repo.upsertReadinessVerdict(USER, {
    date: DAY, verdict: 'poor', score: 41, band: { median: 63, low: 57, high: 69.5 },
    baselineDays: 28, baselineSameVersionDays: 3, contributors: {}, readinessModelVersion: 'v-test', modelVersion: 1,
  })
  const stateNow = async () => (await repo.getReadinessVerdict(USER, DAY))?.responseState

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'issue-3982@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })
  beforeEach(async () => { await pool.query(`DELETE FROM readiness_verdicts WHERE user_id = $1`, [USER]); await seed() })
  afterAll(async () => { await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })

  it('none → rated', async () => {
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'rated')).toBe(true)
    expect(await stateNow()).toBe('rated')
  })
  it('none → dismissed', async () => {
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'dismissed')).toBe(true)
    expect(await stateNow()).toBe('dismissed')
  })
  it('dismissed → rated: the person came back to answer', async () => {
    await repo.setReadinessVerdictResponse(USER, DAY, 'dismissed')
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'rated')).toBe(true)
    expect(await stateNow()).toBe('rated')
  })
  it('rated → dismissed stays rated, and the day still counts as answered', async () => {
    await repo.setReadinessVerdictResponse(USER, DAY, 'rated')
    const before = (await pool.query(`SELECT updated_at FROM readiness_verdicts WHERE user_id = $1`, [USER])).rows[0].updated_at
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'dismissed')).toBe(true)
    expect(await stateNow()).toBe('rated')
    const after = (await pool.query(`SELECT updated_at FROM readiness_verdicts WHERE user_id = $1`, [USER])).rows[0].updated_at
    expect(after).toEqual(before)                       // the row was not touched
  })
  it('rated → rated changes nothing and answers true', async () => {
    await repo.setReadinessVerdictResponse(USER, DAY, 'rated')
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'rated')).toBe(true)
    expect(await stateNow()).toBe('rated')
  })
  it('dismissed → dismissed changes nothing and answers true', async () => {
    await repo.setReadinessVerdictResponse(USER, DAY, 'dismissed')
    expect(await repo.setReadinessVerdictResponse(USER, DAY, 'dismissed')).toBe(true)
    expect(await stateNow()).toBe('dismissed')
  })
  it('a day with no verdict is still false', async () => {
    expect(await repo.setReadinessVerdictResponse(USER, '2019-01-01', 'rated')).toBe(false)
  })
})

// #2377 — the shadow readiness step must not change the live readiness at all. The live payload is
// byte-identical whether or not the shadow step has run. (That the hook never throws or waits is
// pinned in `lib/health/__tests__/shadow-readiness-service.test.ts`.) Runs only against a real
// Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000237702'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('readiness-score — live payload unchanged by the shadow step (#2377)', () => {
  let pool: import('pg').Pool
  let today: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    const { seedShadowHistory } = await import('@/lib/health/__tests__/shadow-readiness-seed')
    pool = getPool()
    today = todayInTz(TZ)
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
      [TEST_USER_ID, `shadow-live-${TEST_USER_ID}@example.com`, TZ],
    )
    // Seeded through today, so the live route has a night and a summary to score.
    await seedShadowHistory(pool, TEST_USER_ID, { end: today, days: 45, tz: TZ, seed: 7 })
  }, 60_000)

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades
  })

  it('serves the same bytes with and without the shadow step having run', async () => {
    const { GET } = await import('../route')
    const service = await import('@/lib/health/shadow-readiness-service')
    // Warm-up read: the live route persists its own derived row on every read, and the first read
    // of a day is the one that creates it. Both compared reads must start from that same state.
    // It also proves the route starts the shadow step: the row appears without anyone asking.
    service.__resetShadowThrottle()
    expect((await GET()).status).toBe(200)
    const deadline = Date.now() + 30_000
    while ((await pool.query(`SELECT 1 FROM shadow_readiness WHERE user_id = $1`, [TEST_USER_ID])).rowCount === 0) {
      if (Date.now() > deadline) throw new Error('the route never started the shadow step')
      await new Promise(r => setTimeout(r, 100))
    }
    await pool.query(`DELETE FROM shadow_readiness WHERE user_id = $1`, [TEST_USER_ID])
    service.__resetShadowThrottle()

    // With: the shadow step has run for today (and the route's own hook is then throttled, so
    // nothing else runs between the two reads).
    await service.scheduleDailyShadowReadiness(TEST_USER_ID, TZ)
    const shadow = await pool.query(`SELECT computed_by FROM shadow_readiness WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, today])
    expect(shadow.rows).toEqual([{ computed_by: 'daily' }])
    const withShadow = await (await GET()).text()

    // Without: the shadow row is gone.
    await pool.query(`DELETE FROM shadow_readiness WHERE user_id = $1`, [TEST_USER_ID])
    const withoutShadow = await (await GET()).text()

    expect(JSON.parse(withShadow).score).not.toBeUndefined()
    expect(withShadow).toBe(withoutShadow)
  }, 60_000)
})

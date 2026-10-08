// issue 2636 — the shadow readiness back-fill route against a real Postgres: a dry run writes
// nothing, dryRun=false writes exactly one 'replay' row per past day into shadow_readiness only, a
// second run replaces its own rows rather than adding, and today gets no row. Skips without
// DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { SHADOW_MODEL_VERSION } from '@trainingai/shared/health/shadow-readiness/model'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000263601'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ, isAdmin: true } })),
}))

describe.skipIf(!canRun)('backfill-shadow-readiness (issue 2636)', () => {
  let pool: import('pg').Pool
  let today: string
  let shiftDateStr: typeof import('@trainingai/shared/date-utils').shiftDateStr

  const stored = async () => (await pool.query(
    `SELECT date::text AS date, model_version, computed_by FROM shadow_readiness
      WHERE user_id = $1 ORDER BY date`, [TEST_USER_ID])).rows

  const call = async (params: string) => {
    const { POST } = await import('../route')
    const { NextRequest } = await import('next/server')
    return (await POST(new NextRequest(`http://localhost/api/admin/backfill-shadow-readiness?${params}`, { method: 'POST' }))).json()
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const dateUtils = await import('@trainingai/shared/date-utils')
    const { seedShadowHistory } = await import('@/lib/health/__tests__/shadow-readiness-seed')
    pool = getPool()
    shiftDateStr = dateUtils.shiftDateStr
    today = dateUtils.todayInTz(TZ)
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES ($1, $2, 'x', $3, true)`,
      [TEST_USER_ID, `backfill-shadow-${TEST_USER_ID}@example.com`, TZ],
    )
    await seedShadowHistory(pool, TEST_USER_ID, { end: shiftDateStr(today, -1), days: 60, tz: TZ })
  }, 60_000)

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM shadow_readiness WHERE user_id = $1`, [TEST_USER_ID])
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%backfill-shadow-readiness%'`)
  })

  it('is a dry run by default: it scores the days and writes nothing', async () => {
    const body = await call(`from=${shiftDateStr(today, -5)}&to=${shiftDateStr(today, -1)}`)
    expect(body.dryRun).toBe(true)
    expect(body.summary.daysExamined).toBe(5)
    expect(body.summary.written).toBe(0)
    expect(await stored()).toHaveLength(0)
  }, 60_000)

  it('dryRun=false writes one replay row per past day, and a rerun replaces rather than adds', async () => {
    const qs = `from=${shiftDateStr(today, -5)}&to=${shiftDateStr(today, -1)}&dryRun=false`
    const first = await call(qs)
    expect(first.summary.written).toBe(5)
    expect(first.summary.wouldReplace).toBe(0)
    const rows = await stored()
    expect(rows).toHaveLength(5)
    for (const r of rows) {
      expect(r.model_version).toBe(SHADOW_MODEL_VERSION)
      expect(r.computed_by).toBe('replay')
    }

    const dry = await call(`from=${shiftDateStr(today, -5)}&to=${shiftDateStr(today, -1)}`)
    expect(dry.summary.wouldReplace).toBe(5)
    await call(qs)
    expect(await stored()).toHaveLength(5)
  }, 120_000)

  it('never writes today, even when the range asks for it', async () => {
    const body = await call(`from=${shiftDateStr(today, -2)}&to=${today}&dryRun=false`)
    expect(body.to).toBe(shiftDateStr(today, -1))
    const dates = (await stored()).map(r => r.date)
    expect(dates).not.toContain(today)
    expect(dates).toHaveLength(2)
  }, 60_000)
})

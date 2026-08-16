// F-2: backfill the persisted Sleep/Readiness scores across history.
//
// The property that matters is that a BACKFILLED day is indistinguishable from a LIVE-computed one
// — otherwise the table it fills is worse than the 21% sample it replaces. These tests pin that
// (via the shared `PillarAudit.persist` payload both paths use), plus the write gate.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f002'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ, isAdmin: true } })),
}))

describe.skipIf(!canRun)('backfill-derived-scores (F-2)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  // Local-date arithmetic via the shared helper. Slicing a UTC ISO string would give yesterday's
  // date before 10am AEST and silently point these fixtures at the wrong day.
  let shiftDateStr: typeof import('@trainingai/shared/date-utils').shiftDateStr
  const dayStr = (offset: number) => shiftDateStr(today, offset)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const dateUtils = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = dateUtils.todayInTz(TZ)
    mid = dateUtils.todayMidnightUtc(TZ)
    shiftDateStr = dateUtils.shiftDateStr
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES ($1, $2, 'x', $3, true)
       ON CONFLICT (id) DO UPDATE SET is_admin = true`,
      [TEST_USER_ID, `f2-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    // The route allows 4 calls/minute — correct for an endpoint that can run ~370 queries, but the
    // suite would trip it after the second test. Reset the counter rather than loosen the limit.
    //
    // BOTH layers have to go. The limiter is L1 (in-memory) + L2 (the `rate_limits` table), and
    // `flushKey` treats the DB as authoritative — it raises L1's count back to the DB's. The flush
    // is fire-and-forget, so clearing L1 alone passes on a fast machine (the flush lands after the
    // test) and fails on a slow one (it lands during). Await the in-flight flushes first, or a late
    // one re-creates the row after the DELETE.
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%backfill-derived-scores%'`)
  })

  /** A scoreable night ending on `today - offset` days. */
  async function seedNight(offset: number) {
    const end = new Date(mid.getTime() - offset * 86_400_000 + 6 * 3_600_000)
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, dayStr(-offset), new Date(end.getTime() - 8 * 3_600_000), end],
    )
  }

  const call = async (params: string) => {
    const { POST } = await import('../route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(`http://localhost/api/admin/backfill-derived-scores?${params}`, { method: 'POST' })
    return (await POST(req)).json()
  }

  it('defaults to a dry run and writes nothing', async () => {
    await seedNight(1)
    const body = await call(`from=${dayStr(-3)}&to=${today}`)
    expect(body.dryRun).toBe(true)
    expect(body.summary.sleep.written).toBeGreaterThan(0)

    const rows = await pool.query(`SELECT sleep_score FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    expect(rows.rowCount).toBe(0)
  })

  it('persists the score when dryRun=false, and is a no-op on a second run', async () => {
    await seedNight(1)
    const first = await call(`from=${dayStr(-3)}&to=${today}&dryRun=false`)
    expect(first.dryRun).toBe(false)
    expect(first.summary.sleep.written).toBeGreaterThan(0)

    const stored = await pool.query(
      `SELECT sleep_score, sleep_contributors FROM oura_daily_derived WHERE user_id = $1 AND sleep_score IS NOT NULL`,
      [TEST_USER_ID],
    )
    expect(stored.rowCount).toBeGreaterThan(0)
    expect(stored.rows[0].sleep_contributors).not.toBeNull()

    // Re-running must recognise the value as already correct rather than rewriting it.
    const second = await call(`from=${dayStr(-3)}&to=${today}&dryRun=false`)
    expect(second.summary.sleep.written).toBe(0)
    expect(second.summary.sleep.unchanged).toBeGreaterThan(0)
  })

  it('writes the same score the live readiness route would have persisted', async () => {
    // The whole point of F-2: a backfilled row must be indistinguishable from a live-written one.
    await seedNight(0)
    await call(`from=${today}&to=${today}&dryRun=false`)
    const backfilled = (await pool.query(
      `SELECT sleep_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [TEST_USER_ID, today])).rows[0]

    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    const { GET } = await import('@/app/api/readiness-score/route')
    await GET(new Request('http://localhost/api/readiness-score') as never)
    const live = (await pool.query(
      `SELECT sleep_score FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [TEST_USER_ID, today])).rows[0]

    expect(backfilled?.sleep_score).not.toBeUndefined()
    expect(backfilled.sleep_score).toBe(live?.sleep_score)
  })

  it('rejects a range wider than the cap and a malformed date', async () => {
    expect((await call('from=2020-01-01&to=2026-12-31')).error).toContain('Range too wide')
    expect((await call('from=nonsense')).error).toContain('Invalid date')
  })

  it('accepts the client slash date form', async () => {
    const slash = today.replace(/-/g, '/')
    const body = await call(`from=${slash}&to=${slash}`)
    expect(body.from).toBe(today)
    expect(body.to).toBe(today)
  })
})

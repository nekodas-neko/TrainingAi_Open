// S2 (data-efficiency review 2026-07-16 §3.2): the day's battery curve must anchor on our
// own derived readiness (or our own sleep score) before falling back to the frozen Cloud
// columns / flat 50. Assertions run in escalating-precedence order on one user.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c2'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('body-battery — anchor precedence (S2)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz(TZ)
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bb-anchor-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('defaults to 50 with no data at all', async () => {
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchor).toBe(50)
    expect(body.anchorSource).toBe('default')
  })

  it('anchors on our own computed sleep score when only a sleep session exists', async () => {
    // 22:00 → 06:00 local, efficiency 92, ~12 min latency → computeSleepScore lands well above 60.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchorSource).toBe('sleep')
    expect(body.anchor).toBeGreaterThan(60)
    expect(body.anchor).toBeLessThanOrEqual(100)
  })

  it('prefers today’s persisted derived readiness over the sleep-score fallback', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    await repo.upsertOuraDailyDerived(TEST_USER_ID, today, { readinessScore: 77, readinessSource: 'ble-derived' })
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.anchor).toBe(77)
    expect(body.anchorSource).toBe('readiness')
  })
})

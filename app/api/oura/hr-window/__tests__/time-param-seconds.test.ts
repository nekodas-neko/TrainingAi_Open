// The activity detail sheet passes `activity_logs.start_time` straight through, and that column is
// a Postgres `time` — so it serialises as "HH:MM:SS". The route's gate accepted only "HH:MM", which
// 400'd every one of those calls before the handler ran, so the sheet's HR chart never rendered.
// Found while converting that read to a cache-seeded fetch (Q-165) — the conversion could not be
// verified because the underlying request had never succeeded.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000a165'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

function req(params: Record<string, string>) {
  return { nextUrl: new URL(`http://localhost/api/oura/hr-window?${new URLSearchParams(params)}`) } as
    unknown as import('next/server').NextRequest
}

describe.skipIf(!canRun)('/api/oura/hr-window — time params', () => {
  let pool: import('pg').Pool
  let day: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    day = todayInTz(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `hr-window-${TEST_USER_ID}@example.com`, TZ],
    )
    // 08:00–08:04 local, five readings, so a correctly-parsed window returns them.
    const midnightUtc = todayMidnightUtc(TZ)
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, $3, 'workout')
         ON CONFLICT (user_id, timestamp) DO NOTHING`,
        [TEST_USER_ID, new Date(midnightUtc.getTime() + (8 * 60 + i) * 60_000), 110 + i],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('accepts the HH:MM:SS the detail sheet actually sends', async () => {
    const { GET } = await import('../route')
    const res = await GET(req({ date: day, startTime: '08:00:00', endTime: '08:45:00' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.readings).toHaveLength(5)
    expect(body.maxHr).toBe(114)
  })

  it('still accepts bare HH:MM, and resolves it to the same window', async () => {
    const { GET } = await import('../route')
    const body = await (await GET(req({ date: day, startTime: '08:00', endTime: '08:45' }))).json()
    expect(body.readings).toHaveLength(5)
  })

  it('still rejects a time that is neither', async () => {
    const { GET } = await import('../route')
    for (const startTime of ['8:00', '08:00:00.5', 'now', '']) {
      const res = await GET(req({ date: day, startTime, endTime: '08:45' }))
      expect(res.status, startTime).toBe(400)
    }
  })
})

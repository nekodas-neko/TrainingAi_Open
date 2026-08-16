// Q-42: Body Battery anchors the day's curve on our own derived readiness, but that row only
// existed once /api/readiness-score had run and persisted it. So the FIRST Body Battery read of
// any day fell back to the sleep score and painted a *provisional* anchor which later changed
// under the user — the thing the owner reported as bothering them.
//
// The route now computes and persists readiness itself when today's row is missing. This test is
// the one that would fail if that were removed: readiness is never fetched here, and the anchor
// must still come out `readiness`.
//
// Its sibling `anchor-source.test.ts` pins the other half — that a user with too little data still
// gets an honest `default`/`sleep` anchor rather than a confident-looking wrong one.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c4'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('body-battery — on-demand readiness anchor (Q-42)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz(TZ)
    mid = todayMidnightUtc(TZ)

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bb-ondemand-${TEST_USER_ID}@example.com`, TZ],
    )

    // Clear this user's derived row and battery snapshot up front, not just in afterAll. The whole
    // premise is "today's readiness row does not exist yet", and a snapshot left behind by a run
    // that died before its teardown would freeze the anchor and make this pass or fail on DB
    // history rather than on the code. Same failure class as Q-146.
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_battery_daily WHERE user_id = $1`, [TEST_USER_ID])

    // Enough history for a composite to form: a night that ended today, plus a fortnight of
    // HRV/RHR so the trailing baselines have something to z-score against.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
    for (let i = 0; i < 14; i++) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, hrv_ms, resting_heart_rate)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, date) DO UPDATE SET hrv_ms = EXCLUDED.hrv_ms,
           resting_heart_rate = EXCLUDED.resting_heart_rate`,
        [TEST_USER_ID, shiftDateStr(today, -i), 60 + (i % 3), 52 + (i % 2)],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('anchors on readiness without /api/readiness-score having run, and persists it', async () => {
    // Precondition: the row Body Battery would normally depend on does not exist yet.
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    expect((await repo.getOuraDailyDerived(TEST_USER_ID, today, today))[0]?.readinessScore ?? null).toBeNull()

    const { GET } = await import('../route')
    const body = await (await GET()).json()

    expect(body.anchorSource).toBe('readiness')
    expect(body.anchorProvisional).toBe(false)

    // Computed AND persisted, so the second read of the day is cheap and every other surface
    // (the Health screen, the readiness card) now agrees with the anchor.
    const persisted = (await repo.getOuraDailyDerived(TEST_USER_ID, today, today))[0]?.readinessScore ?? null
    expect(persisted).not.toBeNull()
    expect(body.anchor).toBe(Math.round(persisted!))
  })
})

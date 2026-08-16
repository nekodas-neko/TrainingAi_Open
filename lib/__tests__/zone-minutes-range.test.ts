// Regression for J-8 (Time-in-Zone dead: dash-form range iterated to zero days) plus the
// zone-cache correctness cluster (J-1/J-2/C-5/H-4): a rewritten HR day must invalidate its cache,
// and a profile drift must recompute rather than serve stale zone bands. DB-backed — runs in CI
// (DATABASE_URL provisioned) and in the local sandbox; skipped otherwise.
import { describe, it, expect, beforeAll } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005d2'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('getZoneMinutesRange — dash-form iteration + cache correctness', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepository>>
  let day: string, from: string, to: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    repo = await getRepository()
    const today = todayInTz(TZ)
    day = shiftDateStr(today, -2) // a completed past day (cacheable), well inside HR retention
    from = shiftDateStr(today, -3)
    to = today

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `zone-range-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])

    // 20 minutes of ~130 bpm HR (Zone-ish under a 190/60 profile), sampled once a minute.
    const base = fromZonedTime(`${day}T08:00:00`, TZ).getTime()
    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let i = 0; i <= 20; i++) {
      params.push(new Date(base + i * 60_000).toISOString(), 130)
      rows.push(`($1, $${params.length - 1}, $${params.length}, 'ble')`)
    }
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${rows.join(',')}
       ON CONFLICT (user_id, timestamp) DO NOTHING`,
      params,
    )
  })

  it('iterates every day in a dash-form range (J-8) and computes non-zero seconds for the HR day', async () => {
    const profile = { maxHr: 190, restingHr: 60 }
    const days = await repo.getZoneMinutesRange(TEST_USER_ID, from, to, TZ, profile)
    // The J-8 bug returned [] here; dash-form iteration must yield one entry per calendar day.
    expect(days.map(d => d.day)).toContain(day)
    expect(days.length).toBe(4) // from..to inclusive = 4 days
    const hrDay = days.find(d => d.day === day)!
    expect(hrDay.seconds.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('stamps the profile on the cached row and recomputes on profile drift (J-2/H-4)', async () => {
    const stamp = await pool.query(
      `SELECT max_hr, resting_hr FROM daily_zone_minutes WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, day],
    )
    expect(stamp.rows[0]).toMatchObject({ max_hr: 190, resting_hr: 60 })

    // A drifted profile must not be served the 190/60 cache — it recomputes and re-stamps.
    await repo.getZoneMinutesRange(TEST_USER_ID, from, to, TZ, { maxHr: 200, restingHr: 50 })
    const restamp = await pool.query(
      `SELECT max_hr, resting_hr FROM daily_zone_minutes WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, day],
    )
    expect(restamp.rows[0]).toMatchObject({ max_hr: 200, resting_hr: 50 })
  })

  it('deleteZoneMinutesFrom drops cached days so a rewritten HR window recomputes (J-1)', async () => {
    const { deleteZoneMinutesFrom } = await import('@/lib/data/postgres/slices/oura')
    const { getDb } = await import('@/lib/data/postgres/client')
    const before = await pool.query(`SELECT count(*)::int n FROM daily_zone_minutes WHERE user_id = $1`, [TEST_USER_ID])
    expect(before.rows[0].n).toBeGreaterThan(0)
    await deleteZoneMinutesFrom(getDb(), TEST_USER_ID, from)
    const after = await pool.query(`SELECT count(*)::int n FROM daily_zone_minutes WHERE user_id = $1`, [TEST_USER_ID])
    expect(after.rows[0].n).toBe(0)
  })
})

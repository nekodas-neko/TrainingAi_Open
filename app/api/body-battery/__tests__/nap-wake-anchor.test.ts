// Q-17: an evening nap must not become the day's wake anchor.
//
// Reproduces the production case of 2026-07-26. The wake anchor was `sleepSessions` sorted by
// `sleepEnd` descending, first element — the same sort-and-take-first that made a nap override the
// night for the Sleep Score (F-1). Here it was worse: once an evening nap landed, `wakeTime` moved
// to the END of that nap, every earlier HR reading fell before it, and the walk consumed nothing.
// Body Battery sat flat at 29 from midnight to midnight with `hr_sample_count = 0` while 164 ring
// samples sat unused after the real 05:54 wake.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000017a9'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('body-battery — the wake anchor is the night, not a nap (Q-17)', () => {
  let pool: import('pg').Pool
  let today: string
  let mid: Date

  const at = (hours: number) => new Date(mid.getTime() + hours * 3_600_000)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz(TZ)
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bb-nap-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
  })

  /** The night of the production case: 22:30 yesterday → 05:54 today. */
  async function seedNight() {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 7, 90, 600)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, at(-1.5), at(5.9)],
    )
  }

  /** The 45-minute evening nap that broke it: 17:24 → 18:09 today. */
  async function seedEveningNap() {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours)
       VALUES ($1, $2, $3, $4, 0.75)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, at(17.4), at(18.15)],
    )
  }

  /**
   * Resting-ish ring readings every 10 minutes from 06:00 to 17:00 local — but never past `now`,
   * because the route only reads HR up to the present moment.
   *
   * Returns how many of those rows fall inside the walk's window `[night end, now]`, so the
   * assertions can be stated against what is actually available. Without this the test is
   * time-of-day dependent: run at 06:41 Brisbane only ~5 rows exist, run at midday ~40 do.
   */
  async function seedDaytimeHr(): Promise<number> {
    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    const nowMs = Date.now()
    const wakeMs = at(5.9).getTime()
    let inWindow = 0
    for (let h = 6; h < 17; h += 1 / 6) {
      const t = at(h)
      if (t.getTime() > nowMs) break
      if (t.getTime() >= wakeMs) inWindow++
      params.push(t, 62)
      rows.push(`($1, $${params.length - 1}, $${params.length}, 'ble')`)
    }
    if (rows.length === 0) return 0
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${rows.join(',')}
       ON CONFLICT DO NOTHING`,
      params,
    )
    return inWindow
  }

  /**
   * Readings in the run's own recent past, in 10-minute steps from local midnight (or an hour
   * ago, whichever is later) up to now. seedDaytimeHr only covers 06:00-17:00 local, so before
   * dawn it seeds nothing and any assertion needing data is unsatisfiable — which is exactly how
   * this file broke at 02:57 Brisbane. Returns how many rows landed, so a run in the first few
   * minutes after midnight (genuinely no data yet) can assert the honest empty path instead.
   */
  async function seedRecentHr(): Promise<number> {
    const nowMs = Date.now()
    const from = Math.max(mid.getTime(), nowMs - 3_600_000)
    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let t = from; t <= nowMs - 60_000; t += 600_000) {
      params.push(new Date(t), 62)
      rows.push(`($1, $${params.length - 1}, $${params.length}, 'ble')`)
    }
    if (rows.length === 0) return 0
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${rows.join(',')}
       ON CONFLICT DO NOTHING`,
      params,
    )
    return rows.length
  }

  it('consumes the day’s HR even when an evening nap is the latest sleep session', async () => {
    await seedNight()
    const available = await seedDaytimeHr()
    await seedEveningNap()

    const { GET } = await import('../route')
    const body = await (await GET()).json()

    // The regression: wakeTime followed the nap to 18:09, leaving nothing to walk. That must
    // hold at ANY hour, so it is asserted first and unconditionally — the nap is never the anchor.
    expect(body.wakeTime).not.toBe(at(18.15).getTime())
    if (at(5.9).getTime() <= Date.now()) {
      expect(body.wakeTime).toBe(at(5.9).getTime())
    } else {
      // Run before 05:54 local: the night's recorded wake is still ahead of now, so the route
      // correctly declines to anchor on it (its own dedicated test below covers that fallback).
      // Asserting the exact wake here is what made this file fail at 02:57 Brisbane.
      expect(body.wakeTime).toBeLessThanOrEqual(Date.now())
    }

    if (available === 0) {
      // Pre-dawn run: the night's recorded end is still ahead of `now`, so there is genuinely
      // nothing to consume. Assert the honest no-data path rather than skipping quietly.
      expect(body.hasData).toBe(false)
      return
    }
    expect(body.hasData).toBe(true)
    // Resting HR sits well under the charge threshold, so the tank must move.
    expect(body.charged).toBeGreaterThan(0)
    // One point per consumed reading, plus the wake anchor — stated against what actually fits in
    // the window, so this holds at any hour rather than only after a full day has elapsed.
    expect(body.series.length).toBeGreaterThanOrEqual(available)
  })

  it('produces the identical curve with and without the nap present', async () => {
    await seedNight()
    await seedDaytimeHr()
    const { GET } = await import('../route')
    const withoutNap = await (await GET()).json()

    await seedEveningNap()
    const withNap = await (await GET()).json()

    expect(withNap.wakeTime).toBe(withoutNap.wakeTime)
    expect(withNap.charged).toBe(withoutNap.charged)
    expect(withNap.drained).toBe(withoutNap.drained)
    expect(withNap.series.length).toBe(withoutNap.series.length)
  })

  it('falls back to the first reading when the recorded wake is still in the future', async () => {
    // The ring stamps a wake later than "now" (the route runs mid-sleep, or the session is
    // recorded ahead). Anchoring on it would leave zero samples and render a flat line that reads
    // as a measurement rather than as missing data.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency)
       VALUES ($1, $2, $3, $4, 8, 90)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, at(-2), new Date(Date.now() + 3 * 3_600_000)],
    )
    // Now-relative, not 06:00-17:00 local: this test is about falling back to the FIRST reading,
    // so it needs a reading to exist whatever the hour.
    const seeded = await seedRecentHr()

    const { GET } = await import('../route')
    const body = await (await GET()).json()

    expect(body.wakeTime).toBeLessThanOrEqual(Date.now())
    // Within the first ten minutes after local midnight there is genuinely nothing to fall back
    // to; assert the honest empty path rather than a fallback that cannot exist.
    expect(body.hasData).toBe(seeded > 0)
  })
})

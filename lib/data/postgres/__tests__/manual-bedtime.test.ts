// Q-519 — the write path for a bedtime the user remembers.
//
// The property under test is narrower than it looks: **one column moves and nothing else does.**
// The design this replaced wrote the remembered value into `sleep_start` at `manual` rank, and the
// audit that entry commissioned found three consumers deriving behaviour from the window rather than
// from the stored duration columns — the worst turning a measured 3 h night into 10 h at 35%
// efficiency (`docs/reviews/2026-08-26-manual-bedtime-write-audit.md`). So every assertion here that
// looks like paranoia about untouched columns is the actual point.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-000000000519'
const OTHER = '00000000-0000-4000-8000-000000000520'
const DATE  = '2026-08-19'

// The owner's reported night: ring fitted at ~4 am, 3 h 5 m recorded.
const MEASURED_START = new Date('2026-08-18T18:23:00.000Z')  // 04:23 Brisbane
const MEASURED_END   = new Date('2026-08-18T22:03:00.000Z')  // 08:03
const REMEMBERED     = new Date('2026-08-18T13:00:00.000Z')  // 23:00 the night before

describe.skipIf(!canRun)('manual bedtime (Q-519)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  const seedNight = async (userId: string, date = DATE, start = MEASURED_START) => {
    await pool.query(
      `INSERT INTO sleep_sessions
         (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, time_in_bed_hours,
          average_hrv_ms, lowest_heart_rate, source_map)
       VALUES ($1,$2,$3,$4,3.08,84,3.67,61,53,'{"duration_hours":"oura_ble"}'::jsonb)`,
      [userId, date, start, MEASURED_END])
  }

  const readNight = async (userId = USER, date = DATE) => (await pool.query(
    `SELECT sleep_start, sleep_end, duration_hours, efficiency, time_in_bed_hours,
            average_hrv_ms, lowest_heart_rate, manual_sleep_start, source_map
     FROM sleep_sessions WHERE user_id = $1 AND date = $2`, [userId, date])).rows[0]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `q519-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query('DELETE FROM sleep_sessions WHERE user_id = $1', [id])
      await pool.query('DELETE FROM users WHERE id = $1', [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query('DELETE FROM sleep_sessions WHERE user_id = $1', [id])
    }
  })

  it('records the remembered bedtime', async () => {
    await seedNight(USER)
    expect(await repo.setManualSleepStart(USER, DATE, REMEMBERED)).toBe(true)
    expect((await readNight()).manual_sleep_start).toEqual(REMEMBERED)
  })

  // The whole design in one assertion.
  it('leaves every measured column exactly as it was', async () => {
    await seedNight(USER)
    const before = await readNight()
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)
    const after = await readNight()

    expect(after.sleep_start).toEqual(before.sleep_start)
    expect(after.sleep_end).toEqual(before.sleep_end)
    expect(after.duration_hours).toBe(before.duration_hours)
    expect(after.efficiency).toBe(before.efficiency)
    expect(after.time_in_bed_hours).toBe(before.time_in_bed_hours)
    expect(after.average_hrv_ms).toBe(before.average_hrv_ms)
    expect(after.lowest_heart_rate).toBe(before.lowest_heart_rate)
  })

  // It is not a competing measurement of the sleep window, so it never enters the rank merge — a
  // `manual` (rank 5) stamp on `duration_hours` would out-rank the ring on that column forever.
  it('does not stamp provenance', async () => {
    await seedNight(USER)
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)
    expect((await readNight()).source_map).toEqual({ duration_hours: 'oura_ble' })
  })

  it('clears with null', async () => {
    await seedNight(USER)
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)
    expect(await repo.setManualSleepStart(USER, DATE, null)).toBe(true)
    expect((await readNight()).manual_sleep_start).toBeNull()
  })

  // A night with no measured sleep has no bedtime to correct, and creating a row would put a
  // session with no duration into every consumer that counts nights.
  it('creates nothing for a date with no session, and says so', async () => {
    expect(await repo.setManualSleepStart(USER, DATE, REMEMBERED)).toBe(false)
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1', [USER])
    expect(rows[0].n).toBe(0)
  })

  it('never reaches another user\'s night on the same date', async () => {
    await seedNight(OTHER)
    expect(await repo.setManualSleepStart(USER, DATE, REMEMBERED)).toBe(false)
    expect((await readNight(OTHER)).manual_sleep_start).toBeNull()
  })

  // `(user_id, sleep_start)` is unique, so each neighbour needs its own start — which is truer to
  // the real table anyway.
  it('touches only the dated night, not the ones around it', async () => {
    await seedNight(USER, '2026-08-18', new Date('2026-08-17T13:00:00.000Z'))
    await seedNight(USER, DATE)
    await seedNight(USER, '2026-08-20', new Date('2026-08-19T13:00:00.000Z'))
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)

    expect((await readNight(USER, '2026-08-18')).manual_sleep_start).toBeNull()
    expect((await readNight(USER, DATE)).manual_sleep_start).toEqual(REMEMBERED)
    expect((await readNight(USER, '2026-08-20')).manual_sleep_start).toBeNull()
  })

  it('advances updated_at, so the sync delta carries it', async () => {
    await seedNight(USER)
    await pool.query(
      `UPDATE sleep_sessions SET updated_at = now() - interval '1 hour' WHERE user_id = $1`, [USER])
    const before = (await pool.query(
      'SELECT updated_at FROM sleep_sessions WHERE user_id = $1', [USER])).rows[0].updated_at
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)
    const after = (await pool.query(
      'SELECT updated_at FROM sleep_sessions WHERE user_id = $1', [USER])).rows[0].updated_at
    expect(after.getTime()).toBeGreaterThan(before.getTime())
  })

  it('surfaces on listSleepSessions so the bedtime estimate can read it', async () => {
    await seedNight(USER)
    await repo.setManualSleepStart(USER, DATE, REMEMBERED)
    const [row] = await repo.listSleepSessions(USER, DATE, DATE)
    expect(row.manualSleepStart).toEqual(REMEMBERED)
    expect(row.sleepStart).toEqual(MEASURED_START)   // the measured start is still the measured one
  })
})

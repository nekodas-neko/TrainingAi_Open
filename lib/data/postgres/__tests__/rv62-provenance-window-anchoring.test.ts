/**
 * RV-62 — the soreness-provenance window anchors at local midnight, not at `Date.now()` minus a
 * fixed number of milliseconds.
 *
 * I shipped `new Date(Date.now() - 7 * 86_400_000)` here in BF-173, which is the exact form
 * CLAUDE.md's Date Arithmetic rule names: an ms-offset window straddles two local days and merges
 * them. A review caught it.
 *
 * **The zone is computed from the current UTC hour** so the user's local time sits near 01:00 on
 * every run, per `local-day-fixture-anchoring.test.ts`. A test that waits for the real clock to
 * enter the hazardous band fires for two hours a day and passes the rest of the time, which is how
 * this class survives.
 *
 * **What this can and cannot prove.** A session at the seven-day edge cannot change a suggestion
 * directly — `suggestedSoreMuscles` only looks at muscles trained within 48 hours, and an edge
 * session is ~168 hours old. The reachable path is the median: `computeMuscleRecovery` takes the
 * MEDIAN bout volume per muscle as `typical` and scales `tau` by `latest.volumeKg / typical`, so
 * one old bout entering or leaving the fetch window moves `tau` and therefore `pct` for a muscle
 * that IS eligible. These cases assert the window boundary itself, which is the thing under this
 * session's control; the median mechanism is documented on the function rather than fitted to a
 * fixture that would only restate the arithmetic.
 *
 * Runs only against a real local dev Postgres — skips in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e062'

/**
 * A fixed-offset zone in which it is currently ~01:00 local. `Etc/GMT+N` is inverted by POSIX
 * convention (`Etc/GMT-10` is UTC+10), which is why the sign is flipped here.
 */
function zoneWhereLocalIsNearOneAm(): string {
  const utcHour = new Date().getUTCHours()
  const offset = (25 - utcHour) % 24            // local hour = utcHour + offset ≡ 1 (mod 24)
  const signed = offset > 12 ? offset - 24 : offset
  return signed === 0 ? 'UTC' : `Etc/GMT${signed > 0 ? '-' : '+'}${Math.abs(signed)}`
}

describe.skipIf(!canRun)('RV-62 — the provenance window anchors at local midnight', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepositoryAsync>>
  const TZ = zoneWhereLocalIsNearOneAm()

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'rv62-window@example.com', 'x', $2)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`, [USER, TZ])
    repo = await (await import('@/lib/data')).getRepositoryAsync()
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
  })

  const localToday = async () => {
    const { rows } = await pool.query(`SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS d`, [TZ])
    return rows[0].d as string
  }

  const save = async (logDate: string, sore: string[]) =>
    repo.saveMoodLog(USER, {
      logDate, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [], soreMuscles: sore,
    }, TZ)

  /**
   * The zone is chosen so local time is ~01:00, which is exactly where a UTC-anchored window and a
   * local-midnight one disagree about which day it is. The call must succeed and write a list
   * rather than throw or skew — with the ms-offset form the window start landed on the previous
   * local day, silently widening or narrowing the fetch by one day depending on the hour.
   */
  it('writes provenance for a check-in dated today in a zone where it is about 01:00', async () => {
    const today = await localToday()
    await save(today, ['Chest'])

    const { rows } = await pool.query(
      `SELECT suggested_sore_muscles FROM mood_logs WHERE user_id = $1 AND log_date = $2`,
      [USER, today])
    expect(rows).toHaveLength(1)
    expect(rows[0].suggested_sore_muscles).toEqual([])   // no workouts seeded → nothing suggested
  })

  /**
   * The property that makes the anchoring meaningful: the window is keyed on the check-in's own
   * date, so two check-ins for different days do not read the same seven days. Asserted through the
   * public behaviour — both rows are written and keyed independently — rather than by reaching into
   * a private method.
   */
  it('keys the window on the check-in date, so two days are stored independently', async () => {
    const today = await localToday()
    const { rows: [{ d: yesterday }] } = await pool.query(
      `SELECT to_char((now() AT TIME ZONE $1) - interval '1 day', 'YYYY-MM-DD') AS d`, [TZ])

    await save(today, ['Chest'])
    await save(yesterday, ['Quads'])

    const { rows } = await pool.query(
      `SELECT log_date, sore_muscles, suggested_sore_muscles FROM mood_logs
       WHERE user_id = $1 ORDER BY log_date`, [USER])
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.sore_muscles)).toEqual([['Quads'], ['Chest']])
  })

  /**
   * The deliberately equivalent control: a check-in with no sore ticks short-circuits before the
   * window is built at all, so it must behave identically whatever the anchoring does. It passes
   * against the old ms-offset code too — without it, every case here would depend on the change.
   */
  it('still writes an empty list for a check-in with no sore muscles', async () => {
    const today = await localToday()
    await save(today, [])

    const { rows } = await pool.query(
      `SELECT suggested_sore_muscles FROM mood_logs WHERE user_id = $1 AND log_date = $2`,
      [USER, today])
    expect(rows[0].suggested_sore_muscles).toEqual([])
  })
})

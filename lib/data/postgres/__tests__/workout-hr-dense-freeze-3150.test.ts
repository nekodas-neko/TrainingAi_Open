// #3150 — the HR prune freezes the calorie gate's verdict (`workout_hr_stats.hr_dense`) just before
// it deletes a workout's series, with the gate's own query and function, so a sparse Health
// Connect-only session stays on METs after its heart rate is gone and a dense one keeps its average.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic series only, anchored
// to local midday 181 days back (past HR_RETENTION_DAYS) or yesterday; the real prune runs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { sql } from 'drizzle-orm'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003150'
const TZ = 'Australia/Brisbane'
const ws = (n: number) => `00000000-0000-4000-8000-00000000315${n}`

const MIN = 60_000
const midday = (daysAgo: number) => fromZonedTime(`${shiftDateStr(todayInTz(TZ), -daysAgo)}T12:00:00`, TZ)
const OLD = midday(181)
const at = (start: Date, mins: number) => new Date(start.getTime() + mins * MIN)

describe.skipIf(!canRun)('the HR prune freezes hr_dense (#3150)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    oura = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3150@example.com', TZ])
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades every table below
  })
  beforeEach(async () => {
    for (const t of ['workout_hr_stats', 'oura_heartrate']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
  })

  /** A completed session with an HR snapshot, as `computeWorkoutHr` leaves it (no verdict). */
  const addSession = async (id: string, start: Date) => {
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at) VALUES ($1, $2, 'Push', $3, $4)`,
      [id, USER, start, at(start, 60)])
    await repo.upsertWorkoutHrStats(USER, id, { avgBpm: 110, peakBpm: 140, hrr1Best: null, workoutHrvMs: null, readingsCount: 61, source: 'health_connect' })
  }
  /** One reading every `stepMin` minutes over [from, to], from `source`. */
  const series = (from: Date, to: Date, stepMin: number, source: string) => pool.query(
    `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
     SELECT $1, ts, 110, $4 FROM generate_series($2::timestamptz, $3::timestamptz, make_interval(mins => $5)) ts
     ON CONFLICT (user_id, timestamp) DO UPDATE SET source = excluded.source`,
    [USER, from, to, source, stepMin])
  const hole = (from: Date, to: Date) => pool.query(
    `DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp > $2 AND timestamp < $3`, [USER, from, to])
  const onHr = async (ids: string[]) => [...(await repo.getAvgBpmBySession(USER, ids)).keys()].sort()
  const stored = async (id: string) =>
    (await pool.query(`SELECT hr_dense FROM workout_hr_stats WHERE workout_session_id = $1`, [id])).rows[0].hr_dense
  const left = async (start: Date) => Number((await pool.query(
    `SELECT count(*) FROM oura_heartrate WHERE user_id = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [USER, start, at(start, 60)])).rows[0].count)

  it('a session dense at first, then given a 25-minute hole by a late Health Connect sync, stays on METs after the prune', async () => {
    await addSession(ws(1), OLD)
    await series(OLD, at(OLD, 60), 1, 'health_connect')
    expect(await onHr([ws(1)])).toEqual([ws(1)])
    await hole(at(OLD, 20), at(OLD, 45))
    await oura.pruneHeartrate(db)
    expect(await left(OLD)).toBe(0)
    expect(await stored(ws(1))).toBe(false)
    expect(await onHr([ws(1)])).toEqual([])
  })

  it('a session thin at first, then filled in by a late sync, keeps the HR estimate after the prune', async () => {
    await addSession(ws(2), OLD)
    await series(OLD, at(OLD, 60), 12, 'health_connect')
    expect(await onHr([ws(2)])).toEqual([])
    await series(OLD, at(OLD, 60), 1, 'health_connect')
    await oura.pruneHeartrate(db)
    expect(await left(OLD)).toBe(0)
    expect(await stored(ws(2))).toBe(true)
    expect(await onHr([ws(2)])).toEqual([ws(2)])
  })

  it('a ring row in the pad does not change the verdict; one inside the span does', async () => {
    const OLD2 = at(OLD, 3 * 60)
    await addSession(ws(3), OLD)
    await addSession(ws(4), OLD2)
    for (const start of [OLD, OLD2]) {
      await series(start, at(start, 60), 12, 'health_connect')
      await series(at(start, -10), at(start, -1), 1, 'ble') // the warm-up pad, outside the span
    }
    await series(at(OLD2, 30), at(OLD2, 30), 1, 'ble')
    await oura.pruneHeartrate(db)
    expect([await stored(ws(3)), await stored(ws(4))]).toEqual([false, true])
    expect(await onHr([ws(3), ws(4)])).toEqual([ws(4)])
  })

  it('the first freeze to reach a session wins, and outranks the part of the series left mid-prune', async () => {
    await addSession(ws(5), OLD)
    // Sparse in its first half, dense in its second.
    await series(OLD, at(OLD, 30), 12, 'health_connect')
    await series(at(OLD, 31), at(OLD, 60), 1, 'health_connect')
    const cutAt = (d: Date) => sql`${d.toISOString()}::timestamptz`
    expect(await oura.freezeWorkoutHrDensity(db, cutAt(at(OLD, 10)))).toBe(1)
    expect(await stored(ws(5))).toBe(false)
    await hole(at(OLD, -1), at(OLD, 30)) // the prune took the first half; what is left is dense
    expect(await oura.freezeWorkoutHrDensity(db, cutAt(at(OLD, 50)))).toBe(0)
    expect(await stored(ws(5))).toBe(false)
    expect(await onHr([ws(5)])).toEqual([])
  })

  it('leaves a session inside retention alone, and a row with neither series nor verdict keeps its snapshot', async () => {
    const RECENT = midday(1)
    await addSession(ws(6), RECENT)
    await series(RECENT, at(RECENT, 60), 12, 'health_connect')
    await addSession(ws(7), OLD)
    await oura.pruneHeartrate(db)
    expect(await left(RECENT)).toBe(6)
    expect([await stored(ws(6)), await stored(ws(7))]).toEqual([null, null])
    expect(await onHr([ws(6), ws(7)])).toEqual([ws(7)]) // ws(6) still judged live: sparse, so METs
  })
})

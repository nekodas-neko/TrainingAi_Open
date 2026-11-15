// #3775 — `workout_hr_stats.hr_dense` is filled when the stats are written, not only at the 180-day
// prune, with the calorie gate's own query and rule. So a sparse gated workout reads false, a strap
// workout true, a session with nothing to judge stays null, and no workout's calories move.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic series anchored to
// local midday yesterday.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003775'
const OTHER = '00000000-0000-4000-8000-000000003776'
const TZ = 'Australia/Brisbane'
const ws = (n: number) => `00000000-0000-4000-8000-0000000377${n}0`

const MIN = 60_000
const START = fromZonedTime(`${shiftDateStr(todayInTz(TZ), -1)}T12:00:00`, TZ)
const at = (mins: number) => new Date(START.getTime() + mins * MIN)
const STATS = { avgBpm: 120, peakBpm: 150, hrr1Best: null, workoutHrvMs: null, source: 'oura_cloud' }

describe.skipIf(!canRun)('hr_dense is stored with the workout HR stats (#3775)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, email] of [[USER, 'issue-3775@example.com'], [OTHER, 'issue-3775b@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
        [id, email, TZ])
    }
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]) // cascades every table below
  })
  beforeEach(async () => {
    for (const t of ['workout_hr_stats', 'oura_heartrate']) await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  const addSession = (id: string, user = USER, fromMin = 0, toMin = 60) => pool.query(
    `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at) VALUES ($1, $2, 'Push', $3, $4)`,
    [id, user, at(fromMin), at(toMin)])
  /** One reading every `stepSec` seconds over [fromMin, toMin], from `source`. */
  const series = (fromMin: number, toMin: number, stepSec: number, source: string, user = USER) => pool.query(
    `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
     SELECT $1, ts, 120, $4 FROM generate_series($2::timestamptz, $3::timestamptz, make_interval(secs => $5)) ts
     ON CONFLICT (user_id, timestamp) DO UPDATE SET source = excluded.source`,
    [user, at(fromMin), at(toMin), source, stepSec])
  const stored = async (id: string) =>
    (await pool.query(`SELECT hr_dense FROM workout_hr_stats WHERE workout_session_id = $1`, [id])).rows[0]?.hr_dense
  const write = (id: string, readingsCount: number) => repo.upsertWorkoutHrStats(USER, id, { ...STATS, readingsCount })

  it('stores false for a reading every seven minutes from a gated source', async () => {
    await addSession(ws(1))
    await series(2, 58, 7 * 60, 'oura_cloud')
    await write(ws(1), 9)
    expect(await stored(ws(1))).toBe(false)
    expect(await repo.getWorkoutHrDensity(USER, ws(1))).toBe(false)
  })

  it('stores true for the strap, and for a gated series dense enough', async () => {
    await addSession(ws(2)); await addSession(ws(3))
    await series(0, 60, 1, 'chest_strap')
    await write(ws(2), 3601)
    expect(await stored(ws(2))).toBe(true)
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await series(0, 60, 5 * 60, 'oura_cloud')
    await write(ws(3), 13)
    expect(await stored(ws(3))).toBe(true)
  })

  it('leaves it null with no reading inside the session, and keeps a stored verdict then', async () => {
    await addSession(ws(4))
    await write(ws(4), 0)
    expect(await stored(ws(4))).toBeNull()
    expect(await repo.getWorkoutHrDensity(USER, ws(4))).toBeNull()
    await series(1, 59, 7 * 60, 'oura_cloud')
    await write(ws(4), 9)
    expect(await stored(ws(4))).toBe(false)
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await write(ws(4), 9) // same count, nothing left to judge: the verdict stays
    expect(await stored(ws(4))).toBe(false)
  })

  it('re-judges on a fuller compute (late heart rate), never on a partial one', async () => {
    await addSession(ws(5))
    await series(2, 58, 7 * 60, 'oura_cloud')
    await write(ws(5), 9)
    expect(await stored(ws(5))).toBe(false)
    await series(0, 60, 5, 'oura_cloud') // the workout's 5-second points arrive late
    await write(ws(5), 721)
    expect(await stored(ws(5))).toBe(true)
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp > $2`, [USER, at(10)])
    await write(ws(5), 120) // mid-prune: fewer readings, the guard keeps the fuller row
    expect(await stored(ws(5))).toBe(true)
  })

  it('moves no calorie figure: the gate answers the same before and after the verdict is stored', async () => {
    const ids = [ws(6), ws(7), ws(8)]
    await addSession(ws(6)); await addSession(ws(7), USER, 70, 130); await addSession(ws(8), USER, 140, 200)
    await series(0, 60, 7 * 60, 'oura_cloud')
    await series(70, 130, 1, 'chest_strap')
    await series(140, 200, 5 * 60, 'oura_cloud')
    // Written with the old path's shape (no verdict), then judged live by the gate.
    for (const id of ids) {
      await pool.query(
        `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, peak_bpm, readings_count, source)
         VALUES ($1, $2, 120, 150, 9, 'oura_cloud')`, [id, USER])
    }
    const before = await repo.getAvgBpmBySession(USER, ids)
    for (const id of ids) await write(id, 9)
    expect(await Promise.all(ids.map(stored))).toEqual([false, true, true])
    const after = await repo.getAvgBpmBySession(USER, ids)
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
    expect([...after.keys()].sort()).toEqual([ws(7), ws(8)])
  })

  it('never reads another user\'s session or heart rate', async () => {
    await addSession(ws(9), OTHER)
    await series(0, 60, 1, 'chest_strap', OTHER)
    expect(await repo.getWorkoutHrDensity(USER, ws(9))).toBeNull()
  })
})

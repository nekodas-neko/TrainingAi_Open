// #3150 — a workout's #2437 density verdict is stored with its HR snapshot (`hr_dense`), so the
// calorie gate still answers once `oura_heartrate` is pruned: a sparse Health Connect-only session
// stays on METs, a dense one keeps its HR average, and a row with no verdict behaves as before.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic series only, anchored
// to yesterday's local midday; the prune is simulated by deleting the session's readings.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003150'
const TZ = 'Australia/Brisbane'
const ws = (n: number) => `00000000-0000-4000-8000-00000000315${n}`

const DAY = shiftDateStr(todayInTz(TZ), -1)
const START = fromZonedTime(`${DAY}T12:00:00`, TZ)
const MIN = 60_000
const LEN = 60 * MIN

describe.skipIf(!canRun)('workout_hr_stats.hr_dense (#3150)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3150@example.com', TZ])
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades every table below
  })
  beforeEach(async () => {
    for (const t of ['workout_hr_stats', 'set_hr_stats', 'oura_heartrate']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
  })

  const addSession = (id: string, start: Date) => pool.query(
    `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at) VALUES ($1, $2, 'Push', $3, $4)`,
    [id, USER, start, new Date(start.getTime() + LEN)])
  /** One reading every `stepMin` minutes across the session, from `source`. */
  const series = (start: Date, stepMin: number, source: string) => pool.query(
    `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
     SELECT $1, ts, 110, $4 FROM generate_series($2::timestamptz, $3::timestamptz, make_interval(mins => $5)) ts`,
    [USER, start, new Date(start.getTime() + LEN), source, stepMin])
  const prune = (start: Date) => pool.query(
    `DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [USER, start, new Date(start.getTime() + LEN)])
  const snapshot = async (id: string, start: Date) => {
    const computed = await computeWorkoutHr(repo, USER, { id, startedAt: start, completedAt: new Date(start.getTime() + LEN) }, TZ)
    await repo.upsertWorkoutHrStats(USER, id, computed!.summary)
    return computed!.summary
  }
  const gated = async (ids: string[]) => [...(await repo.getAvgBpmBySession(USER, ids)).keys()].sort()

  it('a sparse Health Connect-only session stays on METs after its series is pruned', async () => {
    await addSession(ws(1), START)
    await series(START, 12, 'health_connect') // gaps of 12 min: fails the 5.5-min rule
    expect((await snapshot(ws(1), START)).hrDense).toBe(false)
    expect(await gated([ws(1)])).toEqual([])
    await prune(START)
    expect(await gated([ws(1)])).toEqual([])
  })

  it('a dense Health Connect-only session keeps its HR average after the prune', async () => {
    await addSession(ws(2), START)
    await series(START, 1, 'health_connect')
    expect((await snapshot(ws(2), START)).hrDense).toBe(true)
    await prune(START)
    expect([...(await repo.getAvgBpmBySession(USER, [ws(2)])).entries()]).toEqual([[ws(2), 110]])
  })

  it('a sparse ring session is not held to the rule, before or after the prune', async () => {
    await addSession(ws(3), START)
    await series(START, 12, 'ble')
    expect((await snapshot(ws(3), START)).hrDense).toBe(true)
    await prune(START)
    expect(await gated([ws(3)])).toEqual([ws(3)])
  })

  it('a snapshot with no verdict (written before the column) keeps today\'s behaviour', async () => {
    await addSession(ws(4), START)
    await repo.upsertWorkoutHrStats(USER, ws(4), { avgBpm: 120, peakBpm: 140, hrr1Best: null, workoutHrvMs: null, readingsCount: 6, source: 'health_connect' })
    expect((await repo.getWorkoutHrStats(USER, ws(4)))?.hrDense).toBeNull()
    // No series: the average stands, as before #3150.
    expect(await gated([ws(4)])).toEqual([ws(4)])
    // A sparse gated series still present: the live check decides, as before #3150.
    await series(START, 12, 'health_connect')
    expect(await gated([ws(4)])).toEqual([])
  })

  it('round-trips the column, and a fuller compute with nothing to judge keeps the verdict', async () => {
    await addSession(ws(5), START)
    const base = { avgBpm: 120, peakBpm: 140, hrr1Best: null, workoutHrvMs: null, source: 'health_connect' }
    await repo.upsertWorkoutHrStats(USER, ws(5), { ...base, readingsCount: 6, hrDense: false })
    expect((await pool.query(`SELECT hr_dense FROM workout_hr_stats WHERE workout_session_id = $1`, [ws(5)])).rows[0].hr_dense).toBe(false)
    await repo.upsertWorkoutHrStats(USER, ws(5), { ...base, readingsCount: 8, hrDense: null })
    expect((await repo.getWorkoutHrStats(USER, ws(5)))?.hrDense).toBe(false)
    await repo.upsertWorkoutHrStats(USER, ws(5), { ...base, readingsCount: 60, hrDense: true })
    expect((await repo.getWorkoutHrStats(USER, ws(5)))?.hrDense).toBe(true)
    // A thinner compute is skipped whole, as for every other column.
    await repo.upsertWorkoutHrStats(USER, ws(5), { ...base, readingsCount: 3, hrDense: false })
    expect((await repo.getWorkoutHrStats(USER, ws(5)))?.hrDense).toBe(true)
  })
})

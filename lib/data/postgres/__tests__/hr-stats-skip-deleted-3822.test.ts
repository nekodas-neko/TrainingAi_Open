// #3822: a delete is a `deleted_at` tombstone, so `set_hr_stats` / `workout_hr_stats` keep their rows
// for a deleted workout, exercise or set. Every reader must leave those out while the live set
// beside them stays. One live set and one dead one of each kind (set, exercise log, session), all on
// the same exercise and inside every reader's window, so a reader that forgets one tombstone keeps a
// row it should not. Runs only with a local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SetHrRow } from '@trainingai/shared/workout/set-hr-stats'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-000000382200'
const WS_LIVE = '00000000-0000-4000-8000-000000382201'
const WS_DEAD = '00000000-0000-4000-8000-000000382202'
const EL_LIVE = '00000000-0000-4000-8000-000000382203'
const EL_DEAD = '00000000-0000-4000-8000-000000382204' // tombstoned exercise log in the live session
const EL_IN_DEAD_WS = '00000000-0000-4000-8000-000000382205'
const SL_LIVE = '00000000-0000-4000-8000-000000382206'
const SL_DEAD = '00000000-0000-4000-8000-000000382207' // tombstoned set beside the live one
const SL_UNDER_DEAD_EL = '00000000-0000-4000-8000-000000382208'
const SL_UNDER_DEAD_WS = '00000000-0000-4000-8000-000000382209'
const EXID = '00000000-0000-4000-8000-00000038220a'

const DEAD_SETS = [SL_DEAD, SL_UNDER_DEAD_EL, SL_UNDER_DEAD_WS]

function mkRow(setLogId: string, exerciseLogId: string, setNumber: number, hrr1Bpm: number): SetHrRow {
  return {
    setLogId, exerciseLogId, exerciseId: EXID, exerciseName: 'Bench Press', phaseType: 'peak', setNumber,
    intensityPct: 90, plannedPct: 90, restTakenSec: 90, plannedRestSec: 90,
    loggedAt: new Date(Date.now() - 2 * 86_400_000),
    peakBpm: 170, avgBpm: 150, bpmAtEnd: 165, drop30s: 20, drop60s: 30, drop90s: 40, drop120s: 45,
    troughBpm: 120, secToPreset: 50, recoveredPreset: true, secToResting: null, recoveredResting: false,
    pctHrrAtRestEnd: 60, secToHrr50: 25, hrr1Bpm, restAdequate: true, readingsCount: 40, coverageOk: true,
    plannedReps: 3, source: 'chest_strap',
  }
}

describe.skipIf(!canRun)('#3822 HR snapshot readers skip deleted workouts, exercises and sets', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const since = new Date(Date.now() - 30 * 86_400_000)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [U, `hr3822-${U}@example.com`])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [U])
    await pool.query(
      `INSERT INTO workout_sessions (id,user_id,session_name,started_at,completed_at,phase_type)
       VALUES ($1,$3,'Push', now()-interval '2 days', now()-interval '2 days'+interval '1 hour','peak'),
              ($2,$3,'Push', now()-interval '3 days', now()-interval '3 days'+interval '1 hour','peak')`,
      [WS_LIVE, WS_DEAD, U])
    await pool.query(
      `INSERT INTO exercise_logs (id,workout_session_id,exercise_name,logged_at)
       VALUES ($1,$4,'Bench Press', now()-interval '2 days'), ($2,$4,'Bench Press', now()-interval '2 days'),
              ($3,$5,'Bench Press', now()-interval '3 days')`,
      [EL_LIVE, EL_DEAD, EL_IN_DEAD_WS, WS_LIVE, WS_DEAD])
    await pool.query(
      `INSERT INTO set_logs (id,exercise_log_id,set_number,weight_kg,reps)
       VALUES ($1,$5,1,100,3), ($2,$5,2,100,3), ($3,$6,1,100,3), ($4,$7,1,100,3)`,
      [SL_LIVE, SL_DEAD, SL_UNDER_DEAD_EL, SL_UNDER_DEAD_WS, EL_LIVE, EL_DEAD, EL_IN_DEAD_WS])

    // Distinct HRR60s so the session max shows which sets fed it.
    await repo.upsertSetHrStats(U, WS_LIVE, [
      mkRow(SL_LIVE, EL_LIVE, 1, 20), mkRow(SL_DEAD, EL_LIVE, 2, 50), mkRow(SL_UNDER_DEAD_EL, EL_DEAD, 1, 60),
    ])
    await repo.upsertSetHrStats(U, WS_DEAD, [mkRow(SL_UNDER_DEAD_WS, EL_IN_DEAD_WS, 1, 70)])
    // The live session's stored best is the dead exercise's 60, as a pre-#3822 recompute could leave it.
    for (const ws of [WS_LIVE, WS_DEAD]) {
      await repo.upsertWorkoutHrStats(U, ws, { avgBpm: 140, peakBpm: 170, hrr1Best: 60, workoutHrvMs: null, readingsCount: 40, source: 'chest_strap' })
    }

    // Tombstone after the writes, the way the app deletes.
    await pool.query(`UPDATE set_logs SET deleted_at = now() WHERE id = $1`, [SL_DEAD])
    await pool.query(`UPDATE exercise_logs SET deleted_at = now() WHERE id = $1`, [EL_DEAD])
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [WS_DEAD])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [U])
    await pool.query(`DELETE FROM users WHERE id=$1`, [U])
  })

  it('the fixture really stores HR rows for the dead sets (so the reads below are not vacuous)', async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM set_hr_stats WHERE user_id = $1`, [U])
    expect(rows[0].n).toBe(4)
  })

  it('getSetHrStatsForSession: the live set only; a deleted session reads empty', async () => {
    expect((await repo.getSetHrStatsForSession(U, WS_LIVE)).map(r => r.setLogId)).toEqual([SL_LIVE])
    expect(await repo.getSetHrStatsForSession(U, WS_DEAD)).toEqual([])
  })

  it('getSetHrStatsForExercise (the exercise HR trend): by id and by name, the live set only', async () => {
    expect((await repo.getSetHrStatsForExercise(U, { exerciseId: EXID, since })).map(r => r.setLogId)).toEqual([SL_LIVE])
    expect((await repo.getSetHrStatsForExercise(U, { exerciseName: 'Bench Press', since })).map(r => r.setLogId)).toEqual([SL_LIVE])
  })

  it('getSetHrStatsSince (coach chat, shadow readiness, recovery profile): the live set only', async () => {
    const ids = (await repo.getSetHrStatsSince(U, since)).map(r => r.setLogId)
    expect(ids).toEqual([SL_LIVE])
    for (const d of DEAD_SETS) expect(ids).not.toContain(d)
  })

  it('listSetHrStatsForHrr1Backfill: the live set only', async () => {
    expect((await repo.listSetHrStatsForHrr1Backfill(U)).map(r => r.setLogId)).toEqual([SL_LIVE])
  })

  it('getWorkoutHrStats (recap): the live session reads, the deleted one is null', async () => {
    expect((await repo.getWorkoutHrStats(U, WS_LIVE))?.avgBpm).toBe(140)
    expect(await repo.getWorkoutHrStats(U, WS_DEAD)).toBeNull()
  })

  it('getAvgBpmBySession (workout calories): a deleted session has no average even when asked by id', async () => {
    const m = await repo.getAvgBpmBySession(U, [WS_LIVE, WS_DEAD])
    expect([...m.keys()]).toEqual([WS_LIVE])
  })

  it('recomputeHrr1Best: the live session best comes from its live set alone; the deleted session is not planned', async () => {
    const { recomputeHrr1Best } = await import('@/lib/workout/recompute-hrr1-best')
    const res = await recomputeHrr1Best({ userId: U, tz: 'Australia/Brisbane', dryRun: true })
    if (!res.ok) throw new Error(res.error)
    expect(res.report.sample.map(c => [c.workoutSessionId, c.before, c.after])).toEqual([[WS_LIVE, 60, 20]])
    expect(res.report.summary.sessionsExamined).toBe(1)
  })
})

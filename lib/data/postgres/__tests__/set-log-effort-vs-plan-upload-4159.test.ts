// #4159: each set's answer on the workout upload, end to end on a real Postgres (skips without
// DATABASE_URL). The model is never called (0 requests); fake users and lifts only.
//
//   - stored beside the set's weight and reps, in the same statement;
//   - a payload without per-set answers stores NULL (every phone in the field today);
//   - a re-upload without answers keeps the stored ones; one with answers replaces both halves; a
//     null entry beside an answered one keeps that set's answer;
//   - an edit of a set's weight or reps keeps its answer;
//   - a bad value is a 400 at the route and an error entry on the sync push, never a 500;
//   - only the caller's own workout's sets are written: another person's set id is refused and their
//     row is untouched;
//   - the lift's answer is not derived from the sets: both are stored as sent, disagreeing or not;
//   - the session read carries each set's answer beside its reps and weight, and writes nothing;
//   - with the lift lock held from another connection for 6 s, the upload is not delayed.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000004159'
const OTHER = '00000000-0000-4000-8000-000000004160'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))

describe.skipIf(!canRun)('set_logs effort_vs_plan through the upload (#4159)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let logExerciseFromPayload: typeof import('@trainingai/shared/workout/log-exercise').logExerciseFromPayload

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise'))
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    pool = getPool()
    for (const u of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
        [u, `set-effort-${u}@example.com`, TZ],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const u of [USER, OTHER]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [u])
      await pool.query(`DELETE FROM users WHERE id = $1`, [u])
    }
  })

  const ids = () => ({ workoutSessionId: randomUUID(), exerciseLogId: randomUUID(), setLogIds: [randomUUID(), randomUUID(), randomUUID()] })
  const payload = (id: ReturnType<typeof ids>, extra: Record<string, unknown> = {}) => ({
    sessionName: 'Set Effort Test',
    exercise: 'Set Effort Bench',
    weights: [60, 60, 60],
    sets: 3,
    reps: [8, 8, 8],
    rpeValues: [7, 7, 8],
    rpeSources: ['expected', 'expected', 'rated'] as ('expected' | 'rated')[],
    ...id,
    ...extra,
  })
  type SetRow = { set_number: number; weight_kg: number; reps: number; effort_vs_plan: number | null; effort_source: string | null }
  const sets = async (exerciseLogId: string) => (await pool.query(
    `SELECT set_number, weight_kg, reps, effort_vs_plan, effort_source FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`,
    [exerciseLogId])).rows as SetRow[]
  const answers = async (exerciseLogId: string) => (await sets(exerciseLogId)).map(r => [r.effort_vs_plan, r.effort_source])
  const lift = async (exerciseLogId: string) => (await pool.query(
    `SELECT effort_vs_plan, effort_source FROM exercise_logs WHERE id = $1`, [exerciseLogId])).rows[0]
  const tapped = (vsPlan: number) => ({ vsPlan, source: 'tapped' as const })
  const dflt = { vsPlan: 0, source: 'default' as const }

  it('stores each set\'s answer beside its weight and reps', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    expect(await sets(id.exerciseLogId)).toEqual([
      { set_number: 1, weight_kg: 60, reps: 8, effort_vs_plan: -1, effort_source: 'tapped' },
      { set_number: 2, weight_kg: 60, reps: 8, effort_vs_plan: 0, effort_source: 'default' },
      { set_number: 3, weight_kg: 60, reps: 8, effort_vs_plan: 1, effort_source: 'tapped' },
    ])
  })

  it('a null entry stores NULL for that set; a payload with no answers stores NULL for all (today\'s phones)', async () => {
    const some = ids()
    await logExerciseFromPayload(USER, payload(some, { setEfforts: [null, tapped(1), null] }), TZ)
    expect(await answers(some.exerciseLogId)).toEqual([[null, null], [1, 'tapped'], [null, null]])
    const none = ids()
    await logExerciseFromPayload(USER, payload(none), TZ)
    expect(await answers(none.exerciseLogId)).toEqual([[null, null], [null, null], [null, null]])
  })

  it('a re-upload without answers keeps the stored ones; one with answers replaces both halves; null keeps', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    // The same workout re-pushed by a build that never held the answers (reps differ: a real replay).
    await logExerciseFromPayload(USER, payload(id, { reps: [8, 8, 7] }), TZ)
    expect(await answers(id.exerciseLogId)).toEqual([[-1, 'tapped'], [0, 'default'], [1, 'tapped']])
    expect((await sets(id.exerciseLogId)).map(r => r.reps)).toEqual([8, 8, 7])
    // A list whose entry is null leaves that set's stored answer alone; an answered entry replaces both halves.
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [null, tapped(1), dflt] }), TZ)
    expect(await answers(id.exerciseLogId)).toEqual([[-1, 'tapped'], [1, 'tapped'], [0, 'default']])
  })

  it('an edit of a set\'s weight or reps keeps its answer', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    const { editExerciseLogWithRepo } = await import('@/lib/workout/exercise-log-edits-core')
    const res = await editExerciseLogWithRepo(repo, USER, { exerciseLogId: id.exerciseLogId, weights: [62.5, 60, 57.5], reps: [8, 9, 10] })
    expect(res.found).toBe(true)
    const after = await sets(id.exerciseLogId)
    expect(after.map(r => [r.weight_kg, r.reps])).toEqual([[62.5, 8], [60, 9], [57.5, 10]])
    expect(after.map(r => [r.effort_vs_plan, r.effort_source])).toEqual([[-1, 'tapped'], [0, 'default'], [1, 'tapped']])
  })

  it('a set removed by an edit and added back by a later edit does not bring its old answer back', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    const { editExerciseLogWithRepo } = await import('@/lib/workout/exercise-log-edits-core')
    await editExerciseLogWithRepo(repo, USER, { exerciseLogId: id.exerciseLogId, weights: [60, 60], reps: [8, 8] })
    // Shortened: the tombstoned tail set no longer holds an answer.
    const tomb = (await pool.query(
      `SELECT effort_vs_plan, effort_source, deleted_at IS NOT NULL AS gone FROM set_logs WHERE exercise_log_id = $1 AND set_number = 3`,
      [id.exerciseLogId])).rows[0]
    expect(tomb).toEqual({ effort_vs_plan: null, effort_source: null, gone: true })
    // Lengthened again: set 3 returns with no answer, the others keep theirs.
    await editExerciseLogWithRepo(repo, USER, { exerciseLogId: id.exerciseLogId, weights: [60, 60, 60], reps: [8, 8, 8] })
    expect(await answers(id.exerciseLogId)).toEqual([[-1, 'tapped'], [0, 'default'], [null, null]])
    // A later upload that does send an answer for it is stored as sent.
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [null, null, tapped(-1)] }), TZ)
    expect(await answers(id.exerciseLogId)).toEqual([[-1, 'tapped'], [0, 'default'], [-1, 'tapped']])
  })

  it('the lift\'s answer is not derived from the sets: both are stored as sent, agreeing or not', async () => {
    const disagree = ids()
    await logExerciseFromPayload(USER, payload(disagree, { effort: tapped(1), setEfforts: [tapped(-1), tapped(-1), dflt] }), TZ)
    expect(await lift(disagree.exerciseLogId)).toEqual({ effort_vs_plan: 1, effort_source: 'tapped' })
    expect(await answers(disagree.exerciseLogId)).toEqual([[-1, 'tapped'], [-1, 'tapped'], [0, 'default']])
    // Set answers alone: the lift's own stays NULL (the phone sends it; the server does not fill it in).
    const setsOnly = ids()
    await logExerciseFromPayload(USER, payload(setsOnly, { setEfforts: [tapped(1), tapped(1), tapped(1)] }), TZ)
    expect(await lift(setsOnly.exerciseLogId)).toEqual({ effort_vs_plan: null, effort_source: null })
    // The lift's answer alone: no set gets one.
    const liftOnly = ids()
    await logExerciseFromPayload(USER, payload(liftOnly, { effort: tapped(1) }), TZ)
    expect(await answers(liftOnly.exerciseLogId)).toEqual([[null, null], [null, null], [null, null]])
  })

  describe('a bad value is a 400 at the route and an error entry on the sync push, never a 500', () => {
    const bad: [string, unknown][] = [
      ['half a pair (value only)', [{ vsPlan: 1 }, null, null]],
      ['half a pair (source only)', [{ source: 'tapped' }, null, null]],
      ['value 2', [{ vsPlan: 2, source: 'tapped' }, null, null]],
      ['source rated', [{ vsPlan: 0, source: 'rated' }, null, null]],
      ['extra key', [{ vsPlan: 0, source: 'default', note: 'x' }, null, null]],
      ['wrong length', [{ vsPlan: 0, source: 'default' }]],
    ]
    it('route', async () => {
      const { POST } = await import('@/app/api/log-exercise/route')
      for (const [label, setEfforts] of bad) {
        const id = ids()
        const req = new NextRequest('http://localhost/api/log-exercise', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, { setEfforts })),
        })
        const res = await POST(req)
        expect(res.status, label).toBe(400)
        expect(await sets(id.exerciseLogId), label).toEqual([])
      }
      // And a good one through the same route is stored.
      const id = ids()
      const ok = await POST(new NextRequest('http://localhost/api/log-exercise', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(id, { setEfforts: [tapped(1), null, dflt] })),
      }))
      expect(ok.status).toBe(200)
      expect(await answers(id.exerciseLogId)).toEqual([[1, 'tapped'], [null, null], [0, 'default']])
    })
    it('sync push', async () => {
      for (const [label, setEfforts] of bad) {
        const id = ids()
        const res = await repo.pushMutations(USER, [{ id: randomUUID(), domain: 'workout_log', date: '2026-11-26', payload: payload(id, { setEfforts }) }])
        expect(res.errors.map(e => e.error), label).toEqual(['Invalid workout_log payload'])
        expect(await sets(id.exerciseLogId), label).toEqual([])
      }
      const id = ids()
      const ok = await repo.pushMutations(USER, [{ id: randomUUID(), domain: 'workout_log', date: '2026-11-26', payload: payload(id, { setEfforts: [null, tapped(-1), dflt] }) }])
      expect(ok.errors).toEqual([])
      expect(await answers(id.exerciseLogId)).toEqual([[null, null], [-1, 'tapped'], [0, 'default']])
    })
  })

  it('an empty setEfforts list is "no answers": the route and the sync push save the sets and keep stored answers', async () => {
    const { POST } = await import('@/app/api/log-exercise/route')
    const viaRoute = ids()
    const ok = await POST(new NextRequest('http://localhost/api/log-exercise', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(viaRoute, { setEfforts: [] })),
    }))
    expect(ok.status).toBe(200)
    expect(await answers(viaRoute.exerciseLogId)).toEqual([[null, null], [null, null], [null, null]])
    // On a re-upload it leaves the answers already stored, as an omitted list does.
    const stored = ids()
    await logExerciseFromPayload(USER, payload(stored, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    const res = await repo.pushMutations(USER, [{ id: randomUUID(), domain: 'workout_log', date: '2026-11-26', payload: payload(stored, { reps: [8, 8, 7], setEfforts: [] }) }])
    expect(res.errors).toEqual([])
    expect((await sets(stored.exerciseLogId)).map(r => r.reps)).toEqual([8, 8, 7])
    expect(await answers(stored.exerciseLogId)).toEqual([[-1, 'tapped'], [0, 'default'], [1, 'tapped']])
  })

  it('only the caller\'s own workout\'s sets are written: another person\'s set id is refused and their row is untouched', async () => {
    const theirs = ids()
    await logExerciseFromPayload(OTHER, payload(theirs, { setEfforts: [tapped(1), tapped(1), tapped(1)] }), TZ)
    const before = await sets(theirs.exerciseLogId)
    // Their exercise log id: refused.
    await expect(logExerciseFromPayload(USER, payload(theirs, { setEfforts: [tapped(-1), tapped(-1), tapped(-1)] }), TZ)).rejects.toThrow()
    // Their set ids under a log of mine: refused.
    const mine = ids()
    await expect(logExerciseFromPayload(USER, payload(mine, { setLogIds: theirs.setLogIds, setEfforts: [tapped(-1), tapped(-1), tapped(-1)] }), TZ)).rejects.toThrow()
    expect(await sets(theirs.exerciseLogId)).toEqual(before)
    expect(await sets(mine.exerciseLogId)).toEqual([])
    // The same two through the sync push: an error answer, not a write, theirs unchanged.
    const viaPush = await repo.pushMutations(USER, [
      { id: randomUUID(), domain: 'workout_log', date: '2026-11-26', payload: payload(theirs, { setEfforts: [tapped(-1), tapped(-1), tapped(-1)] }) },
    ])
    expect(viaPush.processed).toBe(0)
    expect(await sets(theirs.exerciseLogId)).toEqual(before)
  })

  it('the session read carries each set\'s answer beside its reps and weight, and nothing it decides moves', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { setEfforts: [tapped(-1), dflt, tapped(1)] }), TZ)
    await pool.query(`UPDATE workout_sessions SET completed_at = started_at + interval '1 hour' WHERE id = $1`, [id.workoutSessionId])
    const { readLog } = await import('@trainingai/shared/ai-periodization/session-read')
    const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 86_400_000)
    const logs = (await repo.getSessionReadLogs(USER, from, to)).filter(l => l.exerciseLogId === id.exerciseLogId)
    expect(logs).toHaveLength(1)
    expect(logs[0].sets.map(s => [s.setNumber, s.reps, s.weightKg, s.setEffortVsPlan, s.setEffortSource])).toEqual([
      [1, 8, 60, -1, 'tapped'], [2, 8, 60, 0, 'default'], [3, 8, 60, 1, 'tapped'],
    ])
    // The read's verdict is the same whatever the sets' answers are.
    const stripped = { ...logs[0], sets: logs[0].sets.map(s => ({ ...s, setEffortVsPlan: null, setEffortSource: null })) }
    const flipped = { ...logs[0], sets: logs[0].sets.map(s => ({ ...s, setEffortVsPlan: 1, setEffortSource: 'tapped' })) }
    expect(readLog(logs[0], 2.5)).toEqual(readLog(stripped, 2.5))
    expect(readLog(logs[0], 2.5)).toEqual(readLog(flipped, 2.5))
  })

  it('with the lift lock held from another connection for 6 s, the upload is not delayed', async () => {
    const id = ids()
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [USER])
      const t0 = Date.now()
      const res = await repo.pushMutations(USER, [
        { id: randomUUID(), domain: 'workout_log', date: '2026-11-26', payload: payload(id, { setEfforts: [tapped(1), dflt, tapped(-1)] }) },
        { id: randomUUID(), domain: 'complete_workout', date: '2026-11-26', payload: { workoutSessionId: id.workoutSessionId, completedAtMs: Date.now() } },
      ])
      const took = Date.now() - t0
      expect(res.errors).toEqual([])
      const line = `[4159] workout_log (with per-set answers) + complete_workout with the lift lock held 6 s from another connection: ${took} ms`
      console.info(line)
      if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n')
      expect(took).toBeLessThan(2500)
      expect(await answers(id.exerciseLogId)).toEqual([[1, 'tapped'], [0, 'default'], [-1, 'tapped']])
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
  })
})

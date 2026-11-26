// #4159: the differential. A payload WITHOUT per-set answers (every phone in the field today) must
// leave every stored row and every generated plan exactly as `main` does; a payload WITH them may
// differ only in the two new `set_logs` columns.
//
// One scenario, run twice on a real Postgres with the model mocked (0 real requests):
//   uploads  nine workouts (three sessions, three lifts) through the sync push's `workout_log` and
//            `complete_workout`, one re-upload of a stored log with other reps, one edit, one delete;
//   plan     the next plan for the session, generated from them.
// then every row of the six tables the upload touches and the plan are dumped, ids replaced by their
// order of first appearance, and the times the database or the clock stamps left out.
//
// `DIFF_OUT=<file>` writes the run WITHOUT answers as JSON. That file is the cross-check against
// `main`: this test is run in a checkout of `main` (where a `setEfforts` key would be stripped, so only
// the "without" half is meaningful there) and the two files are compared byte for byte.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'

const model = vi.hoisted(() => ({ answer: null as Record<string, unknown> | null, calls: 0 }))
vi.mock('ai', async orig => ({
  ...(await orig<typeof import('ai')>()),
  generateObject: async () => {
    model.calls++
    if (!model.answer) throw new Error('no model in this test')
    return { object: structuredClone(model.answer) }
  },
}))
vi.mock('@/lib/ai/instrument', async orig => ({
  ...(await orig<typeof import('@/lib/ai/instrument')>()),
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-000000004161'
const LIFTS = ['Differential Squat 4159', 'Differential Bench 4159', 'Differential Row 4159']
const uid = (n: number) => `00000000-0000-4000-9000-${String(4159_000 + n).padStart(12, '0')}`
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)

type Dump = { rows: Record<string, unknown[]>; plan: unknown; counts: { rows: number; sets: number; plans: number } }
type Answer = { vsPlan: -1 | 0 | 1; source: 'tapped' | 'default' } | null

describe.skipIf(!canRun)('the upload differential (#4159)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let libIds: string[] = []

  async function scenario(withAnswers: boolean): Promise<Dump> {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, 'differential-4159@example.com', TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Differential','ai_dynamic',true,'hypertrophy', now() - interval '90 days') RETURNING id`, [USER])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Differential Day',0,90) RETURNING id`, [program])).rows[0].id
    const lifts: string[] = []
    for (const [i, name] of LIFTS.entries()) {
      lifts.push((await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, libIds[i], i, i === 0 ? 'primary' : 'secondary', ['quads']])).rows[0].id)
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status, last_session_ran_prescription, phase_started_at)
       VALUES ($1,$2,'accumulation',3,true,'none',true, now() - interval '30 days')`, [USER, session])

    const today = todayInTz(TZ)
    let n = 0
    const logIds: string[] = []
    // One answer per set, varied, used only when `withAnswers`.
    const cycle: Answer[] = [{ vsPlan: -1, source: 'tapped' }, { vsPlan: 0, source: 'default' }, { vsPlan: 1, source: 'tapped' }, null]
    for (const [w, back] of [9, 6, 3].entries()) {
      const day = shiftDateStr(today, -back)
      const wsId = uid(++n)
      const muts: { id: string; domain: string; date: string; payload: Record<string, unknown> }[] = []
      for (const [li, name] of LIFTS.entries()) {
        const setCount = 3 + (li === 1 ? 1 : 0)
        const reps = Array.from({ length: setCount }, (_, i) => (w === 2 && li === 0 && i === setCount - 1 ? 8 : 10))
        const logId = uid(++n)
        logIds.push(logId)
        const startedAt = local(day, 12).getTime()
        const payload: Record<string, unknown> = {
          sessionName: 'Differential Day', sessionId: session, workoutSessionId: wsId, exerciseLogId: logId,
          setLogIds: Array.from({ length: setCount }, () => uid(++n)),
          exercise: name, weights: Array(setCount).fill(80 - li * 20), reps, sets: setCount, localDate: day,
          workoutStartedAt: startedAt,
          setEndTimes: Array.from({ length: setCount }, (_, i) => startedAt + (li * 8 + i + 1) * 180_000),
          progressionStyle: Array.from({ length: setCount }, () => ({ pct: 70, reps: 10, restSec: 180 })),
          plannedWeights: Array(setCount).fill(80 - li * 20), prescriptionBasisKg: 100,
          muscleGroups: ['quads'], intensityMode: 'full', wasOverride: false,
          // The phone's pre-fill on every set, and the lift's answer on its last log.
          rpeValues: Array(setCount).fill(7), rpeSources: Array(setCount).fill('expected'),
          ...(w === 2 && li === 0 ? { effort: { vsPlan: 1, source: 'tapped' } } : {}),
          ...(w === 2 && li === 1 ? { effort: { vsPlan: 0, source: 'default' } } : {}),
          ...(withAnswers ? { setEfforts: Array.from({ length: setCount }, (_, i) => cycle[(w + li + i) % cycle.length]) } : {}),
        }
        muts.push({ id: uid(900 + n), domain: 'workout_log', date: day, payload })
      }
      muts.push({ id: uid(900 + ++n), domain: 'complete_workout', date: day, payload: { workoutSessionId: wsId, completedAtMs: local(day, 13).getTime() } })
      const res = await repo.pushMutations(USER, muts)
      expect(res.errors).toEqual([])
    }
    // A re-upload of a stored log with other reps (and, with answers, a null list entry that keeps the stored one).
    const replayDay = shiftDateStr(today, -3)
    const stored = (await pool.query(`SELECT exercise_log_id, id FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`, [logIds[7]])).rows
    const replay = await repo.pushMutations(USER, [{
      id: uid(990), domain: 'workout_log', date: replayDay,
      payload: {
        sessionName: 'Differential Day', sessionId: session, workoutSessionId: uid(7), exerciseLogId: logIds[7],
        setLogIds: stored.map(r => r.id), exercise: LIFTS[1], weights: Array(4).fill(60), reps: [10, 10, 9, 9], sets: 4, localDate: replayDay,
        workoutStartedAt: local(replayDay, 12).getTime(), muscleGroups: ['quads'], intensityMode: 'full', wasOverride: false,
        ...(withAnswers ? { setEfforts: [null, null, null, null] } : {}),
      },
    }])
    expect(replay.errors).toEqual([])
    // One edit and one delete, the other two sync domains that write sets.
    const edit = await repo.pushMutations(USER, [
      { id: uid(991), domain: 'exercise_log_edit', date: replayDay, payload: { exerciseLogId: logIds[6], weights: [82.5, 82.5, 80], reps: [10, 9, 9] } },
      { id: uid(992), domain: 'exercise_log_delete', date: shiftDateStr(today, -9), payload: { exerciseLogId: logIds[2] } },
    ])
    expect(edit.errors).toEqual([])

    // The next plan, from what those uploads stored. The model is a mock.
    model.answer = {
      phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'Steady.',
      exercises: lifts.map((id, i) => ({ session_exercise_id: id, name: LIFTS[i], sets: 4, reps: 10, pct: 70 - i * 5, rest_sec: 180 })),
    }
    const res = await generate(USER, session, repo, TZ)
    expect(res.ok).toBe(true)
    const plan = (res as { prescription: unknown }).prescription

    // ── The dump ──────────────────────────────────────────────────────────────────────────────────────────────
    const SKIP = /(^|_)(updated_at|created_at|client_edited_at|started_at|completed_at|logged_at|generated_at|expires_at|phase_started_at)$/
    const dumpTable = async (sql: string, params: unknown[]) => {
      const rows = (await pool.query(sql, params)).rows as Record<string, unknown>[]
      // A tombstone's time is the clock's; that it is set is the row's.
      return rows.map(r => Object.fromEntries(
        Object.entries(r).filter(([k]) => !SKIP.test(k)).map(([k, v]) => [k, k === 'deleted_at' ? v != null : v]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      ))
    }
    const rows: Record<string, unknown[]> = {
      workout_sessions: await dumpTable(`SELECT * FROM workout_sessions WHERE user_id = $1 ORDER BY started_at, id`, [USER]),
      exercise_logs: await dumpTable(`SELECT el.* FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = $1 ORDER BY el.exercise_name, el.logged_at, el.id`, [USER]),
      set_logs: await dumpTable(`SELECT sl.* FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id JOIN workout_sessions ws ON ws.id = el.workout_session_id WHERE ws.user_id = $1 ORDER BY el.exercise_name, el.logged_at, sl.set_number`, [USER]),
      personal_records: await dumpTable(`SELECT * FROM personal_records WHERE user_id = $1 ORDER BY exercise_name`, [USER]),
      user_stats: await dumpTable(`SELECT * FROM user_stats WHERE user_id = $1`, [USER]),
      session_periodization: await dumpTable(`SELECT * FROM session_periodization WHERE user_id = $1`, [USER]),
    }
    // Rows are counted before the two new columns are taken off the comparison below.
    const counts = {
      rows: Object.values(rows).reduce((a, r) => a + r.length, 0),
      sets: rows.set_logs.length,
      plans: 1,
    }
    return normalise({ rows, plan, counts })
  }

  /** Every uuid is replaced by the order it first appears in; every plan time is dropped. */
  function normalise(d: Dump): Dump {
    const seen = new Map<string, string>()
    const text = JSON.stringify(d, (k, v) => (/At$|^generated|^expires/.test(k) ? undefined : v))
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, m => {
        if (!seen.has(m)) seen.set(m, `<id${seen.size}>`)
        return seen.get(m)!
      })
    // An object keyed by an id lists its keys in the ids' order, which is random; sort them.
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)]))
      : v
    return sorted(JSON.parse(text)) as Dump
  }
  const withoutNewColumns = (d: Dump): Dump => ({
    ...d,
    rows: { ...d.rows, set_logs: (d.rows.set_logs as Record<string, unknown>[]).map(({ effort_vs_plan: _a, effort_source: _b, ...rest }) => rest) },
  })

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ;({ generatePrescriptionForSession: generate } = await import('@trainingai/shared/ai-periodization/generate-prescription'))
    for (const name of LIFTS) {
      libIds.push((await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY['barbell'], $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`,
        [name, JSON.stringify([{ muscle: 'quads', role: 'main' }])])).rows[0].id)
    }
  })

  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool?.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [LIFTS])
  })

  it('without per-set answers: the run is repeatable, and (DIFF_OUT) written out to compare with main', async () => {
    const a = await scenario(false)
    const b = await scenario(false)
    expect(b).toEqual(a)
    // The scenario really wrote rows and a plan, and no set has an answer.
    expect(a.counts.sets).toBeGreaterThan(20)
    expect((a.rows.set_logs as { effort_vs_plan: unknown }[]).every(r => r.effort_vs_plan === null)).toBe(true)
    expect((a.plan as { exercises: unknown[] }).exercises.length).toBe(3)
    const digest = createHash('sha256').update(JSON.stringify(a)).digest('hex').slice(0, 16)
    const line = `[4159] without answers: ${a.counts.rows} rows (${a.counts.sets} sets) and ${a.counts.plans} plan, digest ${digest}`
    console.info(line)
    if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n')
    if (process.env.DIFF_OUT) writeFileSync(process.env.DIFF_OUT, JSON.stringify(a, null, 1))
  })

  it('with per-set answers: only the two new set_logs columns differ, and the plan is the same', async () => {
    const without = await scenario(false)
    const calls = model.calls
    const withA = await scenario(true)
    const stored = (withA.rows.set_logs as { effort_vs_plan: number | null; effort_source: string | null }[])
    const answered = stored.filter(r => r.effort_vs_plan != null)
    expect(answered.length).toBeGreaterThan(5)
    expect(answered.every(r => r.effort_source != null)).toBe(true)
    expect(stored.filter(r => r.effort_vs_plan == null).every(r => r.effort_source == null)).toBe(true)
    expect(withoutNewColumns(withA)).toEqual(withoutNewColumns(without))
    expect(withA.plan).toEqual(without.plan)
    expect(model.calls).toBe(calls + 1)
    const line = `[4159] with answers: ${withA.counts.rows} rows compared, ${answered.length} of ${stored.length} sets carry an answer; every other column and the plan identical`
    console.info(line)
    if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n')
  })
})

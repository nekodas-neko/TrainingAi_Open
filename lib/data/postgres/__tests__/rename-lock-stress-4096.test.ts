/**
 * #4096: an exercise rename started at the same moment as each other writer of the rows it touches, round
 * after round, ends with no deadlock (40P01), no wait past the 4 s bound, no error of any kind, and no
 * connection left idle in a transaction.
 *
 * The gated tests in `rename-program-lock-order-4096.test.ts` are the proof of the order; this is the
 * measurement that nothing else of the five writers' real statements cycles with it either. NOT part of
 * `pnpm test` (it takes minutes): run with `STRESS_4096=1` (rounds per writer: `STRESS_ROUNDS`, default 20).
 *
 *   STRESS_4096=1 DATABASE_URL=... pnpm vitest run lib/data/postgres/__tests__/rename-lock-stress-4096.test.ts
 *
 * Writers: a Coach apply (removing a session exercise), a weekly check-in save, a workout log and finish, a
 * program save (the editor's), and a plan generation's store. Real Postgres, made-up names, model never called.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL && process.env.STRESS_4096 === '1'
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 20)
const TZ = 'Australia/Brisbane'
const OWNER = randomUUID()
const U = randomUUID()
const TAG = OWNER.slice(0, 8)
const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

const code = (e: unknown): string | undefined => {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code
    if (typeof c === 'string') return c
  }
  return undefined
}

describe.skipIf(!canRun)(`rename against each writer, ${ROUNDS} rounds (#4096)`, () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let apply: typeof import('@/lib/coach/apply')
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let stampOf: typeof import('@trainingai/shared/ai-periodization/lift-preference-moved').liftPreferencesStamp
  const libIds: string[] = []
  const stats: Record<string, { rounds: number; maxMs: number; errors: string[] }> = {}

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    apply = await import('@/lib/coach/apply')
    engine = await import('@/lib/weekly-checkin/engine')
    period = await import('@/lib/data/postgres/slices/periodization')
    stampOf = (await import('@trainingai/shared/ai-periodization/lift-preference-moved')).liftPreferencesStamp
    for (const u of [OWNER, U]) await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [u, `q4096s-${u}@example.com`, TZ])
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER, U]])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
    console.info('[#4096 stress]', JSON.stringify(stats))
  })

  const planOf = (rows: object[]) => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
    estimatedSessionDurationMin: 45, weeklyVolumeContribution: {}, exercises: rows,
  })

  /** One round's fixture: library row `name` (renamable by OWNER), a program of U with a session of two lifts, history, a stored plan. */
  const seed = async (name: string, other: string) => {
    const lib = async (n: string, owned: boolean) => {
      const id = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles, created_by) VALUES ($1, ARRAY['barbell'], '[{"muscle":"quads","role":"main"}]'::jsonb, $2) RETURNING id`, [n, owned ? OWNER : null])).rows[0].id as string
      libIds.push(id)
      return id
    }
    const idA = await lib(name, true)
    const idB = await lib(other, false)
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [U])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Stress 4096','ai_dynamic',false,'strength', now() - interval '90 days') RETURNING id`, [U])).rows[0].id as string
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [program])).rows[0].id as string
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id as string
    for (const day of [0, 1, 2]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, session])
    const ex = async (n: string, id: string, pos: number) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary','{quadriceps}') RETURNING id`, [session, n, id, pos])).rows[0].id as string
    const exA = await ex(name, idA, 0)
    const exB = await ex(other, idB, 1)
    for (const [n, id] of [[name, idA], [other, idB]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,120)`, [U, n, id])
    }
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day',$3,$4) RETURNING id`, [U, session, local(d, 12), local(d, 13)])).rows[0].id as string
      for (const [n, id] of [[name, idA], [other, idB]] as const) {
        const el = (await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`, [ws, n, id, local(d, 12.5)])).rows[0].id as string
        for (let k = 1; k <= 3; k++) {
          await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec) VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, k, d === 2 && k === 2 ? 3 : 5])
        }
      }
    }
    const plan = planOf([
      { sessionExerciseId: exA, name, sets: 3, reps: 5, pct: 75, restSec: 150 },
      { sessionExerciseId: exB, name: other, sets: 3, reps: 5, pct: 75, restSec: 150 },
    ])
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,'accumulation', now() - interval '30 days', $3,'accepted',true, now(), now() + interval '3 days')`, [U, session, JSON.stringify(plan)])
    return { idA, program, session, exA, exB }
  }
  type Fx = Awaited<ReturnType<typeof seed>>

  const writers: Record<string, (fx: Fx, name: string, other: string) => Promise<unknown>> = {
    'Coach apply (removes a session exercise)': (fx) =>
      apply.applyCoachPatch(db, U, { domain: 'session_exercise', targetId: fx.exA, changes: [{ id: 'c', field: 'removed', from: false, to: true }] } as never, ['c'], '2026-11-22', TZ),
    'weekly check-in save': async (fx) => {
      const ctx = { db, repo, userId: U, tz: TZ, now: NOW }
      try {
        return await engine.saveCheckin(ctx, {
          weekStart: W0,
          lifts: [{ sessionExerciseId: fx.exA, answer: 'heavy' }, { sessionExerciseId: fx.exB, answer: 'heavy' }],
          pain: null, swap: null, daysOff: null, shorterSessionMin: null,
        })
      } catch (e) {
        // A refusal the person sees as a message (a card not due, already saved) is an answer, not a failure.
        if (e instanceof engine.CheckinRefusal && e.status !== 409) return 'refused'
        throw e
      }
    },
    'workout log and finish': async (fx, name) => {
      const ws = await repo.createWorkoutSession(U, fx.session, 'Day', new Date())
      await repo.logExerciseAndSets(U,
        { workoutSessionId: ws.id, exerciseName: name, muscleGroups: ['quadriceps'], loggedAt: new Date(), estimated1rm: 110, target80: 88 } as never,
        [{ setNumber: 1, weightKg: 80, reps: 5, useFor1rm: true }] as never)
      return repo.completeWorkoutSession(ws.id, U, new Date())
    },
    'program save (the editor)': async (fx) => {
      const listed = (await repo.listPrograms(U)).find(p => p.id === fx.program)!
      return repo.saveProgram(U, { ...listed, name: `Edited ${randomUUID().slice(0, 6)}` })
    },
    'plan generation store': async (fx, name, other) => {
      const names = [name, other]
      const expires = new Date(Date.now() + 3 * 86_400_000)
      const plan = planOf([
        { sessionExerciseId: fx.exA, name, sets: 3, reps: 5, pct: 75, restSec: 150 },
        { sessionExerciseId: fx.exB, name: other, sets: 3, reps: 5, pct: 75, restSec: 150 },
      ]) as never
      return period.storePrescriptionForCurrentPreferences(db, U, fx.session, plan, expires, 'accepted' as never, undefined, {
        names, weekStart: W0, stamp: stampOf(new Map(), names),
        finalize: p => p, restate: () => plan,
      })
    },
  }

  for (const [label, writer] of Object.entries(writers)) {
    it(`${label}: ${ROUNDS} rounds beside a rename, no deadlock, no wait over 4 s`, async () => {
      const st = (stats[label] = { rounds: 0, maxMs: 0, errors: [] as string[] })
      for (let round = 0; round < ROUNDS; round++) {
        const name = `Q4096s ${TAG} ${Object.keys(stats).length}-${round} Lift`
        const other = `${name} Other`
        const fx = await seed(name, other)
        const timed = async (what: string, fn: () => Promise<unknown>) => {
          await new Promise(r => setTimeout(r, Math.random() * 12))
          const t0 = Date.now()
          try {
            await fn()
          } catch (e) {
            st.errors.push(`${what}: ${code(e) ?? ''} ${(e as Error).message}`.slice(0, 200))
          }
          const ms = Date.now() - t0
          st.maxMs = Math.max(st.maxMs, ms)
          return ms
        }
        await Promise.all([
          timed('rename', () => repo.renameExercise(OWNER, fx.idA, `${name} renamed`)),
          timed('writer', () => writer(fx, name, other)),
        ])
        st.rounds++
      }
      const idle = Number((await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`)).rows[0].n)
      expect(st.errors).toEqual([])
      expect(st.maxMs).toBeLessThan(4000)
      expect(idle).toBe(0)
    }, 600_000)
  }
})

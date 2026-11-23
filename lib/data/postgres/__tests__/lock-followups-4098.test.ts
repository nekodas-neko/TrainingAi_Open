/**
 * #4098: follow-ups from the lock-order review of #4093.
 *
 * - A READ that repairs something (the program-phase sync, the session read's baseline self-heal) never waits
 *   for a writer: with the person's lift lock held from another connection it returns at once and skips the
 *   repair; the next read, after the lock is released, makes it.
 * - A baseline workout finished while the lock is held keeps its measured anchors (the partial write), and the
 *   self-heal's personal records do not replace them.
 *
 * Real Postgres only (DATABASE_URL). Made-up user; everything removed in `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
import { isBusyError } from '@trainingai/shared/errors'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = '00000000-0000-4000-8000-000000004098'
const GATE = 40981 // advisory key the triggers below wait on
const PROGRAM = '00000000-0000-4000-8000-0000000040a1'
const SLOT = '00000000-0000-4000-8000-0000000040a2'
const LIFT = 'Q4098 Squat'
const ALT = 'Q4098 Hack Squat'
const RENAMED = 'Q4098 Back Squat'

describe.skipIf(!canRun)('lock follow-ups (#4098)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let lock: typeof import('@/lib/coach/lock-wait')
  let wasWait = 0

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    period = await import('@/lib/data/postgres/slices/periodization')
    lock = await import('@/lib/coach/lock-wait')
    wasWait = lock.lockWait.ms
    repo = await (await import('@/lib/data')).getRepositoryAsync()
  })
  afterAll(async () => {
    if (lock) lock.lockWait.ms = wasWait
    if (!pool) return
    await pool.query(`DELETE FROM error_events WHERE user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
  })
  beforeEach(async () => {
    lock.lockWait.ms = wasWait
    await pool.query(`DELETE FROM error_events WHERE user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, `q4098-${U}@example.com`, TZ])
  })

  /** An AI-plan program with `names.length` exercises in one session, its periodization row in `phase`. */
  const seed = async (names: string[], phase: 'baseline' | 'accumulation', baselineComplete: boolean) => {
    const program = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, is_active) VALUES ($1,'Q4098','ai_dynamic',true) RETURNING id`, [U])).rows[0].id as string
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [program])).rows[0].id as string
    const exercises: { id: string; exerciseName: string }[] = []
    for (const [i, name] of names.entries()) {
      const id = (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1,$2,$3) RETURNING id`, [session, name, i])).rows[0].id as string
      exercises.push({ id, exerciseName: name })
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, baseline_complete) VALUES ($1,$2,$3, now() - interval '30 days', $4)`,
      [U, session, phase, baselineComplete])
    return { program, session, exercises }
  }
  const row = async (session: string) => (await pool.query(`SELECT * FROM session_periodization WHERE program_session_id = $1`, [session])).rows[0]

  /** Another connection holding the person's lift lock, as a check-in save does. */
  const holding = async <T>(fn: () => Promise<T>): Promise<T> => {
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
      return await fn()
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
  }

  describe('item 2: a read never waits for a writer', () => {
    it('the program-phase sync returns at once with the lock held, skips its repair, and makes it on the next read', async () => {
      const { program, session } = await seed(['Bench'], 'accumulation', true)
      const { syncProgramPhase } = await import('@trainingai/shared/ai-periodization/program-phase')
      expect((await row(session)).pending_transition).toBeNull()
      await holding(async () => {
        const t0 = Date.now()
        await syncProgramPhase(repo, U, program, TZ, new Date(), { read: true })
        expect(Date.now() - t0).toBeLessThan(1000)
      })
      expect((await row(session)).pending_transition, 'repair skipped while the lock was held').toBeNull()
      await syncProgramPhase(repo, U, program, TZ, new Date(), { read: true })
      expect((await row(session)).pending_transition, 'repaired on the next read').not.toBeNull()
    })

    it('a write keeps the wait: the same sync without read:true waits the lock out, then is refused as busy', async () => {
      const { program } = await seed(['Bench'], 'accumulation', true)
      lock.lockWait.ms = 400
      const { syncProgramPhase } = await import('@trainingai/shared/ai-periodization/program-phase')
      await holding(async () => {
        const t0 = Date.now()
        await syncProgramPhase(repo, U, program, TZ, new Date())
        expect(Date.now() - t0).toBeGreaterThanOrEqual(350)
      })
    })

    it('the session read\'s baseline self-heal: busy in well under a second with the lock held, nothing written, then heals', async () => {
      const { session, exercises } = await seed(['Bench'], 'baseline', false)
      const baseline = { [exercises[0].id]: { kg: 100, source: 'personal_record' as const } }
      await holding(async () => {
        const t0 = Date.now()
        await expect(period.setBaselineComplete(db, U, session, baseline, { read: true })).rejects.toSatisfy(isBusyError)
        expect(Date.now() - t0).toBeLessThan(1000)
      })
      expect((await row(session)).baseline_complete).toBe(false)
      await period.setBaselineComplete(db, U, session, baseline, { read: true })
      expect((await row(session)).baseline_complete).toBe(true)
    })
  })

  describe('item 4: a baseline workout finished while the lock is held keeps its measured anchors', () => {
    it('the partial write stores them; the self-heal then completes from them, not from personal records', async () => {
      lock.lockWait.ms = 200
      const { session, exercises } = await seed(['Bench', 'Row'], 'baseline', false)
      const ws = await repo.createWorkoutSession(U, session, 'Day', new Date())
      for (const [name, rm] of [['Bench', 100], ['Row', 80]] as const) {
        await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at) VALUES ($1,$2,$3, now())`, [ws.id, name, rm])
      }
      const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
      await holding(async () => {
        const t0 = Date.now()
        await completeWorkoutFromPayload(U, { workoutSessionId: ws.id })
        expect(Date.now() - t0, 'the finish is not delayed by the anchor write').toBeLessThan(1500)
        const deadline = Date.now() + 8000
        while (Object.keys((await row(session)).baseline_1rm ?? {}).length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
      })
      const stored = await row(session)
      expect(stored.baseline_1rm[exercises[0].id]).toEqual({ kg: 100, source: 'amrap' })
      expect(stored.baseline_1rm[exercises[1].id]).toEqual({ kg: 80, source: 'amrap' })
      expect(stored.baseline_complete, 'the lock was busy, so the phase is completed by the self-heal').toBe(false)
    })
  })

  // ── item 5: a check-in's swap accept against an exercise rename, for the same person ───────────────────
  describe('item 5: swap accept against an exercise rename (same person)', () => {
    const libIds: string[] = []
    const ids = {} as Record<string, string>
    let engine: typeof import('@/lib/weekly-checkin/engine')
    let checkin: string
    beforeAll(async () => {
      engine = await import('@/lib/weekly-checkin/engine')
      // Gates: while the test holds the advisory lock exclusively, an update of the slot row (the swap) or of
      // the program row (the rename's bump) waits holding the rows it already locked.
      await pool.query(`CREATE OR REPLACE FUNCTION test_4098_gate() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN PERFORM pg_advisory_xact_lock_shared(${GATE}, 1); RETURN NEW; END $f$`)
    })
    afterAll(async () => {
      await pool.query(`DROP TRIGGER IF EXISTS test_4098_slot ON session_exercises`).catch(() => undefined)
      await pool.query(`DROP TRIGGER IF EXISTS test_4098_program ON programs`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS test_4098_gate()`).catch(() => undefined)
      await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [LIFT, ALT, RENAMED]])
    })
    beforeEach(async () => {
      await pool.query(`DROP TRIGGER IF EXISTS test_4098_slot ON session_exercises`)
      await pool.query(`DROP TRIGGER IF EXISTS test_4098_program ON programs`)
      await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[LIFT, ALT, RENAMED]])
      libIds.length = 0
      const lib: Record<string, string> = {}
      for (const name of [LIFT, ALT]) {
        lib[name] = (await pool.query(
          `INSERT INTO exercise_library (name, equipment, muscles, created_by) VALUES ($1, ARRAY['barbell'], $2::jsonb, $3) RETURNING id`,
          [name, JSON.stringify([{ muscle: 'q4098-quads', role: 'main' }]), U])).rows[0].id
        libIds.push(lib[name])
      }
      await pool.query(`INSERT INTO programs (id, user_id, name, phase_mode, is_active) VALUES ($1,$2,'Q4098 swap','manual',true)`, [PROGRAM, U])
      const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [PROGRAM])).rows[0].id
      await pool.query(`INSERT INTO session_exercises (id, session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,0,'primary',ARRAY['quadriceps'])`, [SLOT, session, LIFT, lib[LIFT]])
      await pool.query(`INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rep_min, rep_max, source) VALUES ($1,$2,$3,6,8,'coach')`, [U, LIFT, lib[LIFT]])
      checkin = (await pool.query(
        `INSERT INTO weekly_checkins (user_id, week_start, applies_week_start, status, saved_at, swap_exercise_name, swap_exercise_id, swap_offer_status)
         VALUES ($1, '2026-11-09', '2026-11-16', 'saved', now(), $2, $3, 'open') RETURNING id`, [U, LIFT, lib[LIFT]])).rows[0].id
      ids.alt = lib[ALT]
      ids.lift = lib[LIFT]
    })

    const waitUntil = async (what: string, test: () => Promise<boolean>) => {
      const deadline = Date.now() + 8000
      while (!(await test())) {
        if (Date.now() > deadline) throw new Error(`never reached: ${what}`)
        await new Promise(r => setTimeout(r, 10))
      }
    }
    const blockedBy = async (pid: number) =>
      (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])).rows.map(r => r.pid as number)
    const code = (err: unknown) => {
      for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; e = (e as { cause?: unknown }).cause, i++) {
        const c = (e as { code?: unknown }).code
        if (typeof c === 'string') return `pg ${c}: ${(e as Error).message}`
      }
      return String(err)
    }
    const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? code(r.reason) : 'ok')

    const accept = async () => {
      const ctx = { db, repo, userId: U, tz: TZ, now: new Date() }
      return engine.resolveOffer(ctx as never, checkin, { kind: 'swap', toExerciseId: ids.alt } as never, 'accept')
    }
    const rename = () => repo.renameExercise(U, ids.lift, RENAMED)

    /** `first` runs until it stops at the gate, holding what it took; `second` queues behind it; the gate opens. */
    const gated = async (first: () => Promise<unknown>, second: () => Promise<unknown>) => {
      const gate = await pool.connect()
      try {
        await gate.query('BEGIN')
        await gate.query(`SELECT pg_advisory_xact_lock(${GATE}, 1)`)
        const gatePid = (await gate.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
        const a = first(); a.catch(() => undefined)
        let firstPid = 0
        await waitUntil('the first writer held at the gate', async () => { firstPid = (await blockedBy(gatePid))[0] ?? 0; return firstPid > 0 })
        const b = second(); b.catch(() => undefined)
        await waitUntil('the second writer queued behind the first', async () => (await blockedBy(firstPid)).length > 0)
        await gate.query('COMMIT')
        return await Promise.allSettled([a, b])
      } finally {
        await gate.query('ROLLBACK').catch(() => undefined)
        gate.release()
      }
    }

    it('the accept holds the slot row, the rename queues behind it: both finish, no deadlock', async () => {
      await pool.query(`CREATE TRIGGER test_4098_slot BEFORE UPDATE ON session_exercises FOR EACH ROW WHEN (OLD.id = '${SLOT}'::uuid) EXECUTE FUNCTION test_4098_gate()`)
      const [accepted, renamed] = await gated(accept, rename)
      expect(outcome(accepted)).toBe('ok')
      expect(outcome(renamed)).toBe('ok')
      expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [SLOT])).rows[0].exercise_name).toBe(ALT)
      expect((await pool.query(`SELECT name FROM exercise_library WHERE id = $1`, [ids.lift])).rows[0].name).toBe(RENAMED)
    })

    it('the rename holds the slot row, the accept queues behind it: both finish, no deadlock', async () => {
      // The rename's second statement bumps the program, after its first statement locked the slot row.
      await pool.query(`CREATE TRIGGER test_4098_program BEFORE UPDATE ON programs FOR EACH ROW WHEN (OLD.id = '${PROGRAM}'::uuid) EXECUTE FUNCTION test_4098_gate()`)
      const [renamed, accepted] = await gated(rename, accept)
      expect(outcome(renamed)).toBe('ok')
      expect(outcome(accepted)).toBe('ok')
      expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [SLOT])).rows[0].exercise_name).toBe(ALT)
      expect((await pool.query(`SELECT name FROM exercise_library WHERE id = $1`, [ids.lift])).rows[0].name).toBe(RENAMED)
    })
  })
})

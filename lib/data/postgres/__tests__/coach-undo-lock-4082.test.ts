/**
 * #4082 review: undo in the domains that apply outside a transaction takes the same per-user, per-domain lock
 * its apply takes (`withDomainLock`). Before, a double-tapped undo was not serialised (both restored, both
 * marked), and an undo racing a new apply of the same thing read a state the apply was about to change.
 *
 * Runs only against a real Postgres (DATABASE_URL). Made-up names and numbers only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const TODAY = '2026-11-22'
const U = '00000000-0000-4000-8000-0000040820d1'

type Domain = 'nutrition_targets' | 'user_goals' | 'program_phase' | 'early_deload' | 'session_exercise' | 'injury'

describe.skipIf(!canRun)("undo takes its domain's lock (#4082 review)", () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let apply: typeof import('@/lib/coach/apply')
  let lockWait: { ms: number }
  let wasWait = 0
  const ids = {} as { program: string; session: string; exercise: string; injury: string }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    apply = await import('@/lib/coach/apply')
    lockWait = (await import('@/lib/coach/lock-wait')).lockWait
    wasWait = lockWait.ms
  })

  // Runs on failure too. Nothing here touches `exercise_library`.
  afterAll(async () => {
    if (lockWait) lockWait.ms = wasWait
    if (pool) await pool.query(`DELETE FROM users WHERE id = $1`, [U])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    lockWait.ms = wasWait
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone, steps_goal) VALUES ($1,$2,'x',$3,8000)`, [U, `q4082-undo-${U}@example.com`, TZ])
    ids.program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, sessions_per_cycle) VALUES ($1,'Undo lock','manual',true,'strength',4) RETURNING id`, [U])).rows[0].id
    ids.session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [ids.program])).rows[0].id
    ids.exercise = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, exercise_role) VALUES ($1,'Q4082 Fly',0,'secondary') RETURNING id`, [ids.session])).rows[0].id
    ids.injury = (await pool.query(
      `INSERT INTO injuries (user_id, muscle_name, severity, started_date) VALUES ($1,'shoulder','mild',$2) RETURNING id`, [U, TODAY])).rows[0].id
  })

  const run = (domain: Domain, targetId: string | null, changes: Record<string, unknown>[]) =>
    apply.applyCoachPatch(db, U, { domain, targetId, changes } as never, changes.map(c => c.id as string), TODAY, TZ)

  const cases: {
    domain: Domain
    changes: () => Record<string, unknown>[]
    target: () => string | null
    /** The advisory key the domain's apply takes, which its undo has to take as well. */
    lock: () => string
    value: () => Promise<unknown>
    wrote: unknown
    start: unknown
  }[] = [
    {
      domain: 'nutrition_targets',
      changes: () => [{ id: 'c', field: 'calories', from: null, to: 2500 }],
      target: () => null,
      lock: () => 'coach_apply:nutrition_targets',
      value: async () => (await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [U])).rows[0]?.calories,
      wrote: 2500, start: undefined,
    },
    {
      domain: 'user_goals',
      changes: () => [{ id: 'c', field: 'stepsGoal', from: 8000, to: 9000 }],
      target: () => null,
      lock: () => 'coach_apply:user_goals',
      value: async () => (await pool.query(`SELECT steps_goal FROM users WHERE id = $1`, [U])).rows[0].steps_goal,
      wrote: 9000, start: 8000,
    },
    {
      domain: 'program_phase',
      changes: () => [{ id: 'c', field: 'sessionsPerCycle', from: 4, to: 5 }],
      target: () => null,
      lock: () => 'coach_apply:program_phase',
      value: async () => (await pool.query(`SELECT sessions_per_cycle FROM programs WHERE id = $1`, [ids.program])).rows[0].sessions_per_cycle,
      wrote: 5, start: 4,
    },
    {
      domain: 'early_deload',
      changes: () => [{ id: 'c', field: 'deloadNow', from: false, to: true }],
      target: () => null,
      lock: () => 'coach_apply:early_deload',
      value: async () => (await pool.query(`SELECT early_deload_week_start::text AS d FROM programs WHERE id = $1`, [ids.program])).rows[0].d,
      wrote: TODAY, start: null,
    },
    {
      domain: 'session_exercise',
      changes: () => [{ id: 'c', field: 'position', from: 0, to: 3 }],
      target: () => ids.exercise,
      lock: () => `coach_apply:session_exercise:${ids.exercise}`,
      value: async () => (await pool.query(`SELECT position FROM session_exercises WHERE id = $1`, [ids.exercise])).rows[0].position,
      wrote: 3, start: 0,
    },
    {
      domain: 'injury',
      changes: () => [{ id: 'c', field: 'resolved', from: false, to: true }],
      target: () => ids.injury,
      lock: () => `coach_apply:injury_resolve:${ids.injury}`,
      value: async () => (await pool.query(`SELECT resolved_date::text AS d FROM injuries WHERE id = $1`, [ids.injury])).rows[0].d,
      wrote: TODAY, start: null,
    },
  ]

  const history = async (domain: string) =>
    (await pool.query(`SELECT id, undone_at FROM coach_changes WHERE user_id = $1 AND domain = $2 ORDER BY applied_at`, [U, domain])).rows

  describe.each(cases)('$domain', c => {
    it('an undo behind a writer that holds the domain lock answers busy past the wait, restores nothing, reports once; after release it undoes', async () => {
      const applied = await run(c.domain, c.target(), c.changes())
      expect(applied).toMatchObject({ ok: true })
      const changeId = (applied as { changeId: string }).changeId
      lockWait.ms = 300
      const other = await pool.connect()
      try {
        await other.query('BEGIN')
        // The key is hashed as a whole in `withDomainLock`: `coach_apply:<domain key>` against the user id.
        await other.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [c.lock(), U])
        const t0 = Date.now()
        const res = await apply.undoCoachChange(db, U, changeId)
        expect(Date.now() - t0).toBeLessThan(3000)
        expect(res).toEqual({ ok: false, reason: 'busy' })
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
      expect(await c.value() ?? undefined).toBe(c.wrote)
      expect((await history(c.domain))[0].undone_at).toBeNull()
      expect(reportServerError).toHaveBeenCalledTimes(1)

      lockWait.ms = wasWait
      expect(await apply.undoCoachChange(db, U, changeId)).toMatchObject({ ok: true })
      expect(await c.value() ?? undefined).toBe(c.start === null ? undefined : c.start)
    })

    it('a second undo of the same change, at the same time, is refused cleanly: restored once, marked once', async () => {
      const applied = await run(c.domain, c.target(), c.changes())
      const changeId = (applied as { changeId: string }).changeId
      const results = await Promise.all(Array.from({ length: 6 }, () => apply.undoCoachChange(db, U, changeId)))
      expect(results.filter(r => r.ok)).toHaveLength(1)
      expect(results.filter(r => !r.ok)).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({
        ok: false, reason: expect.stringMatching(/^(invalid|stale)$/),
      })))
      expect(results.some(r => !r.ok && r.reason === 'invalid' && r.detail === 'Already undone')).toBe(true)
      expect((await history(c.domain)).map(h => h.undone_at !== null)).toEqual([true])
      expect(await c.value() ?? undefined).toBe(c.start === null ? undefined : c.start)
      expect(reportServerError).not.toHaveBeenCalled()
    }, 30_000)
  })

  it('nutrition targets end to end: undo and a new apply racing each other leave a consistent history', async () => {
    await pool.query(`INSERT INTO nutrition_targets (user_id, calories) VALUES ($1, 2000)`, [U])
    const first = await run('nutrition_targets', null, [{ id: 'a', field: 'calories', from: 2000, to: 2400 }])
    const firstId = (first as { changeId: string }).changeId
    const [undone, second] = await Promise.all([
      apply.undoCoachChange(db, U, firstId),
      run('nutrition_targets', null, [{ id: 'b', field: 'calories', from: 2400, to: 2600 }]),
    ])
    const calories = (await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [U])).rows[0].calories
    const rows = await history('nutrition_targets')
    // Either order is a valid history, but never a mix: if the undo went first the apply is refused as stale
    // (the plan it read is gone) and 2000 stands; if the apply went first the undo is refused as stale (a later
    // change is in effect) and 2600 stands.
    if (undone.ok) {
      expect(second).toMatchObject({ ok: false, reason: 'stale' })
      expect(calories).toBe(2000)
      expect(rows.map(r => r.undone_at !== null)).toEqual([true])
    } else {
      expect(undone).toMatchObject({ ok: false, reason: 'stale' })
      expect(second).toMatchObject({ ok: true })
      expect(calories).toBe(2600)
      expect(rows.map(r => r.undone_at !== null)).toEqual([false, false])
    }
  })
})

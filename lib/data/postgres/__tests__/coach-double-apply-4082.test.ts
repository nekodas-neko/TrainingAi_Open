/**
 * #4082: a double tap on a Coach apply that reads a value and then writes it.
 *
 * `nutrition_targets` (`goals.ts`) read the current row and then upserted with no lock: two applies at once
 * both read the same value, both passed the stale check, both wrote, and both recorded the same "before", so
 * the second was not refused and the undo history held one starting point twice. The other apply domains that
 * run outside a transaction had the same read-then-write (user goals, program phase, early deload, a session
 * exercise, an injury marked recovered). Each now reads and writes under one lock per user and domain.
 *
 * Runs only against a real Postgres (DATABASE_URL). Made-up names and numbers only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const TODAY = '2026-11-22'
const U = '00000000-0000-4000-8000-0000040820b1'
const PARALLEL = 6

describe.skipIf(!canRun)('double apply on a read-then-write domain (#4082)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let apply: typeof import('@/lib/coach/apply')
  const ids = {} as { program: string; session: string; exercise: string; injury: string }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    apply = await import('@/lib/coach/apply')
  })

  // Runs on failure too. Nothing here touches `exercise_library`.
  afterAll(async () => {
    if (pool) await pool.query(`DELETE FROM users WHERE id = $1`, [U])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone, steps_goal) VALUES ($1,$2,'x',$3,8000)`, [U, `q4082-double-${U}@example.com`, TZ])
    ids.program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, sessions_per_cycle) VALUES ($1,'Double apply','manual',true,'strength',4) RETURNING id`, [U])).rows[0].id
    ids.session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [ids.program])).rows[0].id
    ids.exercise = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, exercise_role) VALUES ($1,'Q4082 Fly',0,'secondary') RETURNING id`, [ids.session])).rows[0].id
    ids.injury = (await pool.query(
      `INSERT INTO injuries (user_id, muscle_name, severity, started_date) VALUES ($1,'shoulder','mild',$2) RETURNING id`, [U, TODAY])).rows[0].id
  })

  type Domain = 'nutrition_targets' | 'user_goals' | 'program_phase' | 'early_deload' | 'session_exercise' | 'injury'
  const run = (domain: Domain, targetId: string | null, changes: Record<string, unknown>[]) =>
    apply.applyCoachPatch(db, U, { domain, targetId, changes } as never, changes.map(c => c.id as string), TODAY, TZ)
  const history = async (domain: string) =>
    (await pool.query(`SELECT id, before_state, undone_at FROM coach_changes WHERE user_id = $1 AND domain = $2 ORDER BY applied_at`, [U, domain])).rows

  const cases: {
    domain: Domain
    changes: () => Record<string, unknown>[]
    target: () => string | null
    value: () => Promise<unknown>
    wrote: unknown
    start: unknown
    /** Every apply lands (each reads what the one before wrote) rather than one winning and the rest being stale. */
    chained?: boolean
  }[] = [
    {
      domain: 'nutrition_targets',
      changes: () => [{ id: 'c', field: 'calories', from: null, to: 2500 }],
      target: () => null,
      value: async () => (await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [U])).rows[0]?.calories,
      wrote: 2500, start: undefined,
    },
    {
      domain: 'user_goals',
      changes: () => [{ id: 'c', field: 'stepsGoal', from: 8000, to: 9000 }],
      target: () => null,
      value: async () => (await pool.query(`SELECT steps_goal FROM users WHERE id = $1`, [U])).rows[0].steps_goal,
      wrote: 9000, start: 8000,
    },
    {
      domain: 'program_phase',
      changes: () => [{ id: 'c', field: 'sessionsPerCycle', from: 4, to: 5 }],
      target: () => null,
      value: async () => (await pool.query(`SELECT sessions_per_cycle FROM programs WHERE id = $1`, [ids.program])).rows[0].sessions_per_cycle,
      wrote: 5, start: 4,
    },
    {
      domain: 'early_deload',
      changes: () => [{ id: 'c', field: 'deloadNow', from: false, to: true }],
      target: () => null,
      value: async () => (await pool.query(`SELECT early_deload_week_start::text AS d FROM programs WHERE id = $1`, [ids.program])).rows[0].d,
      wrote: TODAY, start: null,
    },
    {
      domain: 'session_exercise',
      changes: () => [{ id: 'c', field: 'position', from: 0, to: 3 }],
      target: () => ids.exercise,
      value: async () => (await pool.query(`SELECT position FROM session_exercises WHERE id = $1`, [ids.exercise])).rows[0].position,
      wrote: 3, start: 0,
    },
    {
      // No `from` for "recovered": a sequential second tap has always written again, so each of the taps lands,
      // and the lock is what makes each record the state the one before left (not the same start twice).
      domain: 'injury',
      changes: () => [{ id: 'c', field: 'resolved', from: false, to: true }],
      target: () => ids.injury,
      value: async () => (await pool.query(`SELECT resolved_date::text AS d FROM injuries WHERE id = $1`, [ids.injury])).rows[0].d,
      wrote: TODAY, start: null, chained: true,
    },
  ]

  describe.each(cases)('$domain', c => {
    it(`${PARALLEL} applies at once: ${'one lands and the rest are refused as stale'}, one history row, and undo restores the start`, async () => {
      const results = await Promise.all(Array.from({ length: PARALLEL }, () => run(c.domain, c.target(), c.changes())))
      const ok = results.filter(r => r.ok)
      if (c.chained) {
        expect(ok).toHaveLength(PARALLEL)
        const rows = await history(c.domain)
        expect(rows).toHaveLength(PARALLEL)
        // Exactly one tap saw the injury unresolved; the rest saw what the one before wrote.
        expect(rows.filter(r => r.before_state.resolvedDate == null)).toHaveLength(1)
      } else {
        expect(ok).toHaveLength(1)
        expect(results.filter(r => !r.ok)).toEqual(Array.from({ length: PARALLEL - 1 }, () => expect.objectContaining({ ok: false, reason: 'stale' })))
        const rows = await history(c.domain)
        expect(rows).toHaveLength(1)
        expect(rows[0].undone_at).toBeNull()
      }
      expect(await c.value()).toBe(c.wrote)

      // Undo in reverse order, newest first, back to the state before the first tap.
      const rows = await history(c.domain)
      for (const row of [...rows].reverse()) expect(await apply.undoCoachChange(db, U, row.id)).toMatchObject({ ok: true })
      // `undefined` for a row that did not exist before the first apply: undo leaves it with the column empty.
      expect(await c.value() ?? undefined).toBe(c.start === null ? undefined : c.start)
      expect(reportServerError).not.toHaveBeenCalled()
    }, 30_000)
  })

  it('nutrition targets, the named case: a double tap behind a writer that holds the lock is refused as stale, not written over it', async () => {
    // Another apply of the same domain is in flight: it holds the lock and has written, not yet committed.
    await pool.query(`INSERT INTO nutrition_targets (user_id, calories) VALUES ($1, 2000)`, [U])
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('coach_apply:nutrition_targets'), hashtext($1))`, [U])
      await other.query(`UPDATE nutrition_targets SET calories = 2400 WHERE user_id = $1`, [U])
      const backend = (await other.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
      const second = run('nutrition_targets', null, [{ id: 'n', field: 'calories', from: 2000, to: 2600 }])
      second.catch(() => undefined)
      const deadline = Date.now() + 5000
      for (;;) {
        const blocked = (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [backend])).rows
        if (blocked.length > 0) break
        if (Date.now() > deadline) throw new Error('the apply never queued behind the lock')
        await new Promise(r => setTimeout(r, 10))
      }
      await other.query('COMMIT')
      const res = await second
      expect(res).toMatchObject({ ok: false, reason: 'stale' })
      expect(res.ok === false && res.reason === 'stale' && res.drift[0]).toMatchObject({ field: 'calories', expected: '2000', actual: '2400' })
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect((await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [U])).rows[0].calories).toBe(2400)
    expect(await history('nutrition_targets')).toHaveLength(0)
  })

  it('injury marked recovered, behind a writer that holds the lock: it records the state that writer left, not the one before it', async () => {
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [`coach_apply:injury_resolve:${ids.injury}`, U])
      await other.query(`UPDATE injuries SET resolved_date = '2026-11-01' WHERE id = $1`, [ids.injury])
      const backend = (await other.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
      const second = run('injury', ids.injury, [{ id: 'r', field: 'resolved', from: false, to: true }])
      second.catch(() => undefined)
      const deadline = Date.now() + 5000
      for (;;) {
        const blocked = (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [backend])).rows
        if (blocked.length > 0) break
        if (Date.now() > deadline) throw new Error('the apply never queued behind the lock')
        await new Promise(r => setTimeout(r, 10))
      }
      await other.query('COMMIT')
      expect(await second).toMatchObject({ ok: true })
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    const rows = await history('injury')
    expect(rows).toHaveLength(1)
    expect(rows[0].before_state).toEqual({ resolvedDate: '2026-11-01' })
  })
})

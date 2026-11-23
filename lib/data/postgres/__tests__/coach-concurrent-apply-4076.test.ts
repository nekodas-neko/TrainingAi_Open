/**
 * #4076: two Coach applies at once on something that does not exist yet.
 *
 * `SELECT ... FOR UPDATE` locks a row that is there and nothing when it is not, so "read, and insert if
 * none" had no lock for a double tap to queue behind. For a lift preference the loser failed on the
 * `(user_id, exercise_id)` unique index — which `ON CONFLICT ... exercise_preferences_lift_key` does not
 * arbitrate — as a raw duplicate-key error, a 500. The same shape sat in the injury apply (no unique key
 * at all: two live rows for one muscle) and in the create-on-swap library insert (unique name).
 *
 * Runs only against a real Postgres (DATABASE_URL). Made-up names and numbers only.
 */
import { sql } from 'drizzle-orm'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

// The error report goes to the error_events table; here it is counted (a stuck lock must be reported, once).
const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))
// The route's own rate limit is not under test (it is shared across runs of this file in a minute).
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
// The route is driven as the signed-in user.
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: '00000000-0000-4000-8000-0000040760a1', timezone: 'Australia/Brisbane' } }) }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-0000040760a1'
const LIFT = 'Q4076 Seated Row'
const OTHER_NAME = 'Q4076 Seated Row (renamed)'
const NEW_LIFT = 'Q4076 Brand New Fly'

describe.skipIf(!canRun)('concurrent Coach applies on a missing row (#4076)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let apply: typeof import('@/lib/coach/apply')
  let libId: string
  const ids = {} as { program: string; session: string; lift: string; slotA: string; slotB: string }

  type Change = Record<string, unknown>
  const liftPatch = (changes: Change[]) => ({ domain: 'lift_preference' as const, targetId: ids.lift, changes }) as never
  const applyLift = (changes: Change[], source?: 'checkin', conn: typeof db = db) =>
    apply.applyCoachPatch(conn, USER, liftPatch(changes), changes.map(c => c.id as string), '2026-11-22', TZ, source ? { source } : {})
  const rest = (id: string, to: number) => [{ id, field: 'restSec', from: null, to }]

  const prefRows = async () => (await pool.query(
    `SELECT id, exercise_id, exercise_name, rest_sec, rep_min, rep_max, next_load_step, sets_delta, source, deleted_at
       FROM exercise_preferences WHERE user_id = $1`, [USER])).rows
  const historyCount = async () =>
    (await pool.query(`SELECT count(*)::int AS n FROM coach_changes WHERE user_id = $1`, [USER])).rows[0].n as number

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    apply = await import('@/lib/coach/apply')
    // Admin: the create-on-swap path is admin-gated.
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES ($1,$2,'x',$3,true)`, [USER, `q4076-${USER}@example.com`, TZ])
    libId = (await pool.query(
      `INSERT INTO exercise_library (name, equipment) VALUES ($1, ARRAY['Cable']) ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`, [LIFT])).rows[0].id
    ids.program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'Race test','ai_dynamic',true,'powerbuilding') RETURNING id`, [USER])).rows[0].id
    ids.session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Pull',0) RETURNING id`, [ids.program])).rows[0].id
    const ex = async (name: string, pos: number, exerciseId: string | null) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role) VALUES ($1,$2,$3,$4,'secondary') RETURNING id`,
        [ids.session, name, exerciseId, pos])).rows[0].id as string
    ids.lift = await ex(LIFT, 0, libId)
    ids.slotA = await ex('Q4076 Slot A', 1, null)
    ids.slotB = await ex('Q4076 Slot B', 2, null)
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    await pool.query(`DELETE FROM exercise_preferences WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM injuries WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE name = $1`, [NEW_LIFT])
  })

  // Runs on failure too: the fixtures are removed by id, and the shared catalogue rows by the id/name made here.
  afterAll(async () => {
    if (!canRun || !pool) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE id = $1 OR name = $2`, [libId ?? null, NEW_LIFT])
  })

  /**
   * Another writer of this lift is in flight and not committed. It follows the lock protocol, and its row
   * carries the library id (the key `lift_key` does not arbitrate) under another name. `start` begins an
   * apply; this waits until that apply is blocked behind the open transaction (on the lock after the fix,
   * on the other's uncommitted index entry before it), then commits, so the commit lands mid-apply.
   */
  const againstHeldWriter = async (start: () => Promise<unknown>) => {
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      // The two locks the apply takes, by hand: this breaks if the key space changes without the apply following it.
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:name'), hashtext($1))`, [`${USER}:${LIFT}`])
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:lib'), hashtext($1))`, [`${USER}:${libId}`])
      await other.query(
        `INSERT INTO exercise_preferences (user_id, exercise_id, exercise_name, rest_sec, source) VALUES ($1,$2,$3,45,'coach')`,
        [USER, libId, OTHER_NAME])
      const backend = (await other.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
      const loser = start()
      loser.catch(() => undefined) // observed below; this only keeps a rejection from being reported as unhandled while we wait
      const deadline = Date.now() + 5000
      for (;;) {
        const blocked = (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [backend])).rows
        if (blocked.length > 0) break
        if (Date.now() > deadline) throw new Error('the apply never blocked behind the open transaction')
        await new Promise(r => setTimeout(r, 10))
      }
      await other.query('COMMIT')
      return await loser
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
  }
  const expectOnlyTheHeldWritersRow = async () => {
    const rows = await prefRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].rest_sec).toBe(45)
    expect(await historyCount()).toBe(0)
  }

  it('lift preference: an apply behind a writer that holds the lift waits, then is refused as stale — never a duplicate-key error', async () => {
    await expect(againstHeldWriter(() => applyLift(rest('x', 60)))).resolves.toMatchObject({ ok: false, reason: 'stale' })
    await expectOnlyTheHeldWritersRow()
  })

  it('weekly check-in: its write (source checkin, inside the caller\'s own transaction) waits the same way and is refused as stale', async () => {
    // The engine applies inside its own `db.transaction` and passes the transaction as `db`.
    const asCheckin = () => db.transaction(tx => applyLift(rest('k1', 60), 'checkin', tx as unknown as typeof db))
    await expect(againstHeldWriter(asCheckin)).resolves.toMatchObject({ ok: false, reason: 'stale' })
    await expectOnlyTheHeldWritersRow()
  })

  it('lift preference: six applies at once on an empty row — none throws, one wins, one history row, and undo restores the start', async () => {
    for (let round = 0; round < 12; round++) {
      await pool.query(`DELETE FROM exercise_preferences WHERE user_id = $1`, [USER])
      await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [USER])
      const settled = await Promise.allSettled([60, 70, 80, 90, 100, 110].map((v, i) => applyLift(rest(`r${i}`, v))))
      const thrown = settled.filter(r => r.status === 'rejected').map(r => String((r as PromiseRejectedResult).reason?.cause?.message ?? (r as PromiseRejectedResult).reason))
      expect(thrown).toEqual([])
      const results = settled.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof applyLift>>>).value)
      const won = results.filter(r => r.ok)
      expect(won).toHaveLength(1)
      for (const r of results.filter(r => !r.ok)) expect(r).toMatchObject({ ok: false, reason: 'stale' })
      expect(await prefRows()).toHaveLength(1)
      expect(await historyCount()).toBe(1)

      // Undo what the winner did: the lift is back to "no preference" (a tombstone, every column empty).
      const undone = await apply.undoCoachChange(db, USER, (won[0] as { changeId: string }).changeId)
      expect(undone.ok).toBe(true)
      const [row] = await prefRows()
      expect(row.deleted_at).not.toBeNull()
      expect([row.rest_sec, row.rep_min, row.rep_max, row.next_load_step, row.sets_delta]).toEqual([null, null, null, null, null])
    }
  })

  it('weekly check-in and Coach applies mixed, at once: none throws, one wins, one history row, undo restores the start', async () => {
    for (let round = 0; round < 12; round++) {
      await pool.query(`DELETE FROM exercise_preferences WHERE user_id = $1`, [USER])
      await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [USER])
      // The engine applies inside its own `db.transaction` and passes the transaction as `db`.
      const asCheckin = (to: number) => db.transaction(tx => applyLift(rest(`k${to}`, to), 'checkin', tx as unknown as typeof db))
      const settled = await Promise.allSettled([asCheckin(60), asCheckin(70), applyLift(rest('c1', 80)), applyLift(rest('c2', 90))])
      const thrown = settled.filter(r => r.status === 'rejected').map(r => String((r as PromiseRejectedResult).reason?.cause?.message ?? (r as PromiseRejectedResult).reason))
      expect(thrown).toEqual([])
      const results = settled.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof applyLift>>>).value)
      const won = results.filter(r => r.ok)
      expect(won).toHaveLength(1)
      expect(await prefRows()).toHaveLength(1)
      expect(await historyCount()).toBe(1)
      const [row] = await prefRows()
      const history = (await pool.query(`SELECT summary FROM coach_changes WHERE user_id = $1`, [USER])).rows[0].summary as string
      expect(history).toContain(String(row.rest_sec))
      expect(['coach', 'checkin']).toContain(row.source)

      const undone = await apply.undoCoachChange(db, USER, (won[0] as { changeId: string }).changeId)
      expect(undone.ok).toBe(true)
      expect((await prefRows())[0].deleted_at).not.toBeNull()
    }
  })

  // ── The wait for the lock is bounded (#4080 review) ───────────────────────────────────────────
  // A holder that keeps the lock longer than the apply will wait used to run the apply into the pool's
  // 15 s statement timeout and out as a 500. The wait is now `lockWait.ms`; the tests shorten it instead
  // of sleeping 15 s.
  describe('a lock held for longer than the apply waits', () => {
    let lockWait: typeof import('@/lib/coach/lock-wait').lockWait
    let was: number
    beforeAll(async () => { lockWait = (await import('@/lib/coach/lock-wait')).lockWait; was = lockWait.ms; lockWait.ms = 300 })
    afterAll(() => { if (lockWait) lockWait.ms = was })

    /** Another session holds a lock and does not let go until `release`. */
    const hold = async (setup: (c: import('pg').PoolClient) => Promise<void>) => {
      const c = await pool.connect()
      await c.query('BEGIN')
      await setup(c)
      return { release: async () => { await c.query('ROLLBACK').catch(() => undefined); c.release() } }
    }
    const holdLift = () => hold(async c => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:name'), hashtext($1))`, [`${USER}:${LIFT}`])
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:lib'), hashtext($1))`, [`${USER}:${libId}`])
    })
    const timed = async <T,>(run: () => Promise<T>) => { const t0 = Date.now(); const out = await run(); return { out, ms: Date.now() - t0 } }

    it('lift preference: refused as busy within the wait, nothing written, reported once; after release a retry succeeds', async () => {
      const holder = await holdLift()
      try {
        const { out, ms } = await timed(() => applyLift(rest('x', 60)))
        expect(out).toEqual({ ok: false, reason: 'busy' })
        expect(ms).toBeGreaterThanOrEqual(250)
        expect(ms).toBeLessThan(3000) // nowhere near the 15 s statement timeout
        expect(await prefRows()).toEqual([])
        expect(await historyCount()).toBe(0)
        expect(reportServerError).toHaveBeenCalledTimes(1)
        // SET LOCAL did not reach the pooled connection the apply used.
        expect((await pool.query(`SHOW lock_timeout`)).rows[0].lock_timeout).toBe('0')
      } finally { await holder.release() }
      const retry = await applyLift(rest('x', 60))
      expect(retry).toMatchObject({ ok: true })
      expect((await prefRows()).map(r => r.rest_sec)).toEqual([60])
      expect(await historyCount()).toBe(1)
    })

    it('the bound ends with the wait: inside a caller\'s transaction the earlier lock_timeout is back once the lock is taken', async () => {
      await db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL lock_timeout = '7s'`)
        const res = await applyLift(rest('x', 60), 'checkin', tx as unknown as typeof db)
        expect(res).toMatchObject({ ok: true })
        const now = (await tx.execute(sql`SHOW lock_timeout`)).rows[0] as { lock_timeout: string }
        expect(now.lock_timeout).toBe('7s')
      })
    })

    it('POST /api/coach/apply answers 409 busy (its own sentence, no drift), nothing written, reported once', async () => {
      const { POST } = await import('@/app/api/coach/apply/route')
      const send = () => POST(new Request('http://localhost/api/coach/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { domain: 'lift_preference', targetId: ids.lift, changes: rest('x', 60) }, acceptedChangeIds: ['x'] }),
      }))
      const holder = await holdLift()
      try {
        const res = await send()
        expect(res.status).toBe(409)
        const body = await res.json()
        expect(body).toEqual({ error: expect.stringMatching(/try again/i), busy: true })
        expect(body.error).not.toMatch(/out of date/i)
        expect(await prefRows()).toEqual([])
        expect(await historyCount()).toBe(0)
        expect(reportServerError).toHaveBeenCalledTimes(1)
      } finally { await holder.release() }
      expect((await send()).status).toBe(200)
      expect(await prefRows()).toHaveLength(1)
    })

    it('injury: refused as busy, no row, reported once; a retry after release logs it', async () => {
      const log = () => apply.applyCoachPatch(db, USER, {
        domain: 'injury', targetId: null,
        changes: [{ id: 'm', field: 'muscleName', from: null, to: 'left shoulder' }],
      } as never, ['m'], '2026-11-22', TZ)
      const holder = await hold(c => c.query(`SELECT pg_advisory_xact_lock(hashtext('injuries:muscle'), hashtext($1))`, [`${USER}:left shoulder`]).then(() => undefined))
      try {
        expect(await log()).toEqual({ ok: false, reason: 'busy' })
        expect((await pool.query(`SELECT count(*)::int AS n FROM injuries WHERE user_id = $1`, [USER])).rows[0].n).toBe(0)
        expect(await historyCount()).toBe(0)
        expect(reportServerError).toHaveBeenCalledTimes(1)
      } finally { await holder.release() }
      expect(await log()).toMatchObject({ ok: true })
    })

    it('create-on-swap: waits on the other admin\'s uncommitted library row, is refused as busy, the slot is unchanged; a retry lands', async () => {
      await pool.query(`UPDATE session_exercises SET exercise_name = 'Q4076 Slot A', exercise_id = NULL WHERE id = $1`, [ids.slotA])
      const swap = () => apply.applyCoachPatch(db, USER, {
        domain: 'session_exercise', targetId: ids.slotA,
        changes: [{ id: 'e1', field: 'exerciseName', from: 'Q4076 Slot A', to: NEW_LIFT }, { id: 'e2', field: 'newExerciseMuscles', from: null, to: 'chest' }],
      } as never, ['e1', 'e2'], '2026-11-22', TZ)
      const holder = await hold(c => c.query(`INSERT INTO exercise_library (name, equipment) VALUES ($1, ARRAY['Cable'])`, [NEW_LIFT]).then(() => undefined))
      try {
        expect(await swap()).toEqual({ ok: false, reason: 'busy' })
        expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids.slotA])).rows[0].exercise_name).toBe('Q4076 Slot A')
        expect(await historyCount()).toBe(0)
        expect(reportServerError).toHaveBeenCalledTimes(1)
      } finally { await holder.release() }
      expect(await swap()).toMatchObject({ ok: true })
      expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids.slotA])).rows[0].exercise_name).toBe(NEW_LIFT)
    })

    it('a check-in\'s own transaction: the apply inside it reports busy, and what the caller wrote before it rolls back with it', async () => {
      const holder = await holdLift()
      let seen: unknown = null
      try {
        await expect(db.transaction(async tx => {
          await tx.execute(sql`INSERT INTO injuries (user_id, muscle_name, severity, started_date) VALUES (${USER}, 'marker 4076', 'mild', '2026-11-22')`)
          seen = await applyLift(rest('k1', 60), 'checkin', tx as unknown as typeof db)
          // What the engine does with it: the whole save fails.
          throw new Error('check-in refused')
        })).rejects.toThrow('check-in refused')
      } finally { await holder.release() }
      expect(seen).toEqual({ ok: false, reason: 'busy' })
      expect((await pool.query(`SELECT count(*)::int AS n FROM injuries WHERE user_id = $1`, [USER])).rows[0].n).toBe(0)
      expect(await prefRows()).toEqual([])
      expect(await historyCount()).toBe(0)
    })
  })

  // ── What "nothing was changed" may claim (#4080 second review) ─────────────────────────────────
  // A statement timeout (57014) is a refusal only where one transaction wraps the whole apply. The other
  // handlers write on the pool first, so the same timeout on the `coach_changes` insert leaves the value
  // changed with no history row: it must stay an error. The timeout is simulated after the write by a
  // trigger that raises 57014 on the history insert for this user only.
  describe('a statement timeout after the write', () => {
    beforeAll(async () => {
      await pool.query(`CREATE OR REPLACE FUNCTION q4080_history_timeout() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.user_id = '${USER}' THEN
            RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = '57014';
          END IF;
          RETURN NEW;
        END $f$`)
    })
    beforeEach(async () => {
      await pool.query(`DROP TRIGGER IF EXISTS q4080_history_timeout ON coach_changes`)
      await pool.query(`CREATE TRIGGER q4080_history_timeout BEFORE INSERT ON coach_changes FOR EACH ROW EXECUTE FUNCTION q4080_history_timeout()`)
    })
    afterAll(async () => {
      if (!pool) return
      await pool.query(`DROP TRIGGER IF EXISTS q4080_history_timeout ON coach_changes`)
      await pool.query(`DROP FUNCTION IF EXISTS q4080_history_timeout()`)
      await pool.query(`DELETE FROM nutrition_targets WHERE user_id = $1`, [USER])
    })

    it('transactional (lift preference): refused as busy, the preference write rolled back, reported once', async () => {
      const out = await applyLift(rest('x', 60))
      expect(out).toEqual({ ok: false, reason: 'busy' })
      expect(await prefRows()).toEqual([])
      expect(await historyCount()).toBe(0)
      expect(reportServerError).toHaveBeenCalledTimes(1)
    })

    it('not transactional (nutrition targets): NOT reported as "nothing was changed" — it throws, and the route answers 500 and reports it', async () => {
      await pool.query(`DELETE FROM nutrition_targets WHERE user_id = $1`, [USER])
      await pool.query(`INSERT INTO nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g) VALUES ($1, 2000, 150, 200, 60)`, [USER])
      const patch = { domain: 'nutrition_targets', targetId: null, changes: [{ id: 'n', field: 'calories', from: 2000, to: 2200 }] }
      // The apply itself: no `busy` refusal. The error surfaces with its code.
      await expect(apply.applyCoachPatch(db, USER, patch as never, ['n'], '2026-11-22', TZ)).rejects.toMatchObject({ cause: { code: '57014' } })
      // The write did commit and there is no history row: which is exactly why it must not say nothing changed.
      expect((await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [USER])).rows[0].calories).toBe(2200)
      expect(await historyCount()).toBe(0)

      await pool.query(`UPDATE nutrition_targets SET calories = 2000 WHERE user_id = $1`, [USER])
      const { POST } = await import('@/app/api/coach/apply/route')
      reportServerError.mockClear()
      const res = await POST(new Request('http://localhost/api/coach/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch, acceptedChangeIds: ['n'] }),
      }))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body).toEqual({ error: 'Apply failed' })
      expect(JSON.stringify(body)).not.toMatch(/nothing was changed/i)
      expect(body.busy).toBeUndefined()
      expect(reportServerError).toHaveBeenCalledTimes(1)
    })
  })

  // ── An apply that races an undo of the change it follows ───────────────────────────────────────
  describe('an apply against an undo of the same change', () => {
    /** The db with the undo's transaction held back until `go`: the undo has read its record and the
     *  row's state and not yet taken the row lock. `reached` resolves when it is waiting. */
    const gatedUndoDb = () => {
      let go!: () => void
      let reachedResolve!: () => void
      const gate = new Promise<void>(r => { go = r })
      const reached = new Promise<void>(r => { reachedResolve = r })
      const gated = new Proxy(db as object, {
        get(target, prop) {
          const v = Reflect.get(target, prop, target)
          if (prop === 'transaction') return async (fn: unknown, cfg: unknown) => { reachedResolve(); await gate; return (v as (a: unknown, b: unknown) => unknown).call(target, fn, cfg) }
          return typeof v === 'function' ? v.bind(target) : v
        },
      }) as typeof db
      return { gated, go, reached }
    }

    it('the apply lands first: the undo, already past its read, is refused as stale and writes nothing; the apply stands', async () => {
      const first = await applyLift(rest('a', 60))
      expect(first).toMatchObject({ ok: true })
      const firstId = (first as { changeId: string }).changeId

      const { gated, go, reached } = gatedUndoDb()
      const undo = apply.undoCoachChange(gated, USER, firstId)
      await reached // the undo has read; it has not locked the row
      const second = await applyLift([{ id: 'b', field: 'restSec', from: 60, to: 90 }])
      expect(second).toMatchObject({ ok: true })
      go()
      expect(await undo).toMatchObject({ ok: false, reason: 'stale' })

      const [row] = await prefRows()
      expect(row.rest_sec).toBe(90) // the apply's value, not put back to the start
      expect(row.deleted_at).toBeNull()
      const history = (await pool.query(`SELECT id, undone_at FROM coach_changes WHERE user_id = $1 ORDER BY applied_at`, [USER])).rows
      expect(history).toHaveLength(2)
      expect(history.every(h => h.undone_at === null)).toBe(true) // the undo marked nothing

      // The apply's own undo still goes back one step, to the first change's value.
      expect(await apply.undoCoachChange(db, USER, (second as { changeId: string }).changeId)).toMatchObject({ ok: true })
      expect((await prefRows())[0].rest_sec).toBe(60)
    })

    it('the apply queues behind an undo that holds the row: it lands on the restored state when its `from` is the state before the change', async () => {
      const first = await applyLift(rest('a', 60))
      const firstId = (first as { changeId: string }).changeId
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      let backend = 0
      let undone: Awaited<ReturnType<typeof apply.undoCoachChange>> | null = null
      const holder = db.transaction(async tx => {
        backend = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
        undone = await apply.undoCoachChange(tx as unknown as typeof db, USER, firstId)
        await gate // the undo's writes are in this transaction, uncommitted, row locked
      })
      while (!undone) await new Promise(r => setTimeout(r, 10))
      const racing = applyLift(rest('b', 90)) // from null: written against the state before the first change
      racing.catch(() => undefined)
      const deadline = Date.now() + 5000
      for (;;) {
        if ((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [backend])).rows.length > 0) break
        if (Date.now() > deadline) throw new Error('the apply never queued behind the undo')
        await new Promise(r => setTimeout(r, 10))
      }
      release()
      await holder
      expect(undone).toMatchObject({ ok: true })
      expect(await racing).toMatchObject({ ok: true })
      const [row] = await prefRows()
      expect([row.rest_sec, row.deleted_at]).toEqual([90, null])
      const history = (await pool.query(`SELECT undone_at FROM coach_changes WHERE user_id = $1 ORDER BY applied_at`, [USER])).rows
      expect(history.map(h => h.undone_at !== null)).toEqual([true, false]) // first undone, second live
    })
  })

  it('injury: six applies at once for one muscle leave one live row, not six', async () => {
    const log = (i: number) => apply.applyCoachPatch(db, USER, {
      domain: 'injury', targetId: null,
      changes: [{ id: `m${i}`, field: 'muscleName', from: null, to: 'left shoulder' }, { id: `s${i}`, field: 'severity', from: null, to: 'mild' }],
    } as never, [`m${i}`, `s${i}`], '2026-11-22', TZ)
    for (let round = 0; round < 8; round++) {
      await pool.query(`DELETE FROM injuries WHERE user_id = $1`, [USER])
      const results = await Promise.all([0, 1, 2, 3, 4, 5].map(log))
      expect(results.every(r => r.ok)).toBe(true)
      expect((await pool.query(`SELECT count(*)::int AS n FROM injuries WHERE user_id = $1 AND deleted_at IS NULL AND resolved_date IS NULL`, [USER])).rows[0].n).toBe(1)
    }
  })

  it('swap to a catalogue entry that does not exist yet: two at once create it once, and both land on it', async () => {
    const { sessionExerciseHandler } = await import('@/lib/coach/domains/session-exercise')
    const swap = (targetId: string, from: string) => {
      const changes = [{ id: 'e1', field: 'exerciseName', from, to: NEW_LIFT }, { id: 'e2', field: 'newExerciseMuscles', from: null, to: 'chest' }]
      return sessionExerciseHandler.apply(db, USER, { domain: 'session_exercise', targetId, changes } as never, changes as never)
    }
    for (let round = 0; round < 8; round++) {
      await pool.query(`DELETE FROM exercise_library WHERE name = $1`, [NEW_LIFT])
      await pool.query(`UPDATE session_exercises SET exercise_name = 'Q4076 Slot A', exercise_id = NULL WHERE id = $1`, [ids.slotA])
      await pool.query(`UPDATE session_exercises SET exercise_name = 'Q4076 Slot B', exercise_id = NULL WHERE id = $1`, [ids.slotB])
      const results = await Promise.all([swap(ids.slotA, 'Q4076 Slot A'), swap(ids.slotB, 'Q4076 Slot B')])
      expect(results.every(r => r.ok)).toBe(true)
      const lib = (await pool.query(`SELECT id FROM exercise_library WHERE name = $1`, [NEW_LIFT])).rows
      expect(lib).toHaveLength(1)
      const slots = (await pool.query(`SELECT exercise_id FROM session_exercises WHERE id = ANY($1)`, [[ids.slotA, ids.slotB]])).rows
      expect(slots.map(r => r.exercise_id)).toEqual([lib[0].id, lib[0].id])
    }
  })
})

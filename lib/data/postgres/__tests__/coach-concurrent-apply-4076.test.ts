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
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

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

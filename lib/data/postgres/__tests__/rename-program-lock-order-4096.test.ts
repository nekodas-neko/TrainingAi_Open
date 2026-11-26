/**
 * #4096: the exercise rename, the Coach's session-exercise swap and the program editor's save take
 * `programs` and `session_exercises` in ONE order: the program row first.
 *
 * Before: the rename (`renameSessionExercises`) updated every `session_exercises` row with the old name
 * and then `programs.updated_at`; the swap tombstoned its exercise row and then bumped its program; the
 * editor's `saveProgram` updated the program row first and then deleted and re-inserted its exercises
 * (and, through the cascade, its plan rows). Each side held what the other wanted: `40P01`, one side a 500.
 *
 * Every case here is gated and two-connection, on a real Postgres: one side is held (by an advisory lock a
 * test trigger waits on) between its two tables until the editor's save is queued, then released. Where the
 * order is wrong, Postgres ends the pair with 40P01 after `deadlock_timeout`; where it is right, both commit.
 * The last case proves the order the rename takes the programs of SEVERAL people in (id order) by holding the
 * second program from outside and looking at what the rename holds meanwhile.
 *
 * Real Postgres only (DATABASE_URL). Safe beside another run on the same database: every id, name, trigger,
 * function and advisory key is made fresh per run, and the one piece of DDL (two gate triggers) is made once.
 * The library rows the cases make are removed by id in `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID, randomInt } from 'node:crypto'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const OWNER = randomUUID() // creates the library rows, so may rename them
const U1 = randomUUID() // owns the programs
const U2 = randomUUID()
const TAG = OWNER.slice(0, 8)
const GATE_K1 = randomInt(1_000_000, 2_000_000_000)
const GATE_K2 = randomInt(1_000_000, 2_000_000_000)
const FN = `gate_4096_${TAG}`

const code = (e: unknown): string | undefined =>
  [e, (e as { cause?: unknown } | null)?.cause].map(x => (x as { code?: unknown } | null)?.code).find((c): c is string => typeof c === 'string')

describe.skipIf(!canRun)('rename, swap and program save lock in one order (#4096)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let apply: typeof import('@/lib/coach/apply')
  const libIds: string[] = []
  let gate: import('pg').PoolClient | null = null

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const until = async <T>(what: string, probe: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T> => {
    const end = Date.now() + ms
    for (;;) {
      const v = await probe()
      if (v) return v
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
      await sleep(20)
    }
  }

  /** DDL against a table other test files write to waits for their transactions: bounded, retried. */
  const ddl = async (text: string) => {
    for (let i = 0; ; i++) {
      const c = await pool.connect()
      try {
        await c.query(`SET lock_timeout = '3s'`)
        await c.query(text)
        return
      } catch (e) {
        if (i >= 8 || !['55P03', '40P01'].includes(code(e) ?? '')) throw e
      } finally {
        c.release()
      }
      await sleep(150 + i * 100)
    }
  }

  /**
   * Where the gate sits. Postgres locks a row's tuple BEFORE it fires a row-level BEFORE UPDATE trigger, so a row
   * trigger on `programs` would make the writer hold the program it is only about to want. The gates are therefore:
   *  - a STATEMENT-level trigger on `programs` / `session_periodization`: it fires before the statement touches a
   *    row, and its condition looks at what only the gated writer's own transaction can see (its uncommitted
   *    change), so it never holds the editor's save, nor a writer of another test;
   *  - a row-level trigger on `session_exercises`, which holds the rows the statement already updated: it waits at
   *    the SECOND row of a session being renamed (the first is already updated and locked).
   * Each condition is a SQL boolean, `false` when the case does not use that gate.
   */
  const setGate = async (g: { programStmt?: string; planStmt?: string; exerciseRow?: string }) => {
    const fn = (suffix: string, cond: string) => pool.query(`CREATE OR REPLACE FUNCTION ${FN}_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF ${cond} THEN PERFORM pg_advisory_xact_lock_shared(${GATE_K1}, ${GATE_K2}); END IF;
        RETURN NEW;
      END $f$`)
    await fn('ps', g.programStmt ?? 'false')
    await fn('sp', g.planStmt ?? 'false')
    await fn('se', g.exerciseRow ?? 'false')
  }
  const closeGate = async () => {
    if (!gate) return
    const g = gate
    gate = null
    await g.query('COMMIT').catch(() => undefined)
    g.release()
  }
  const holdGate = async () => {
    gate = await pool.connect()
    await gate.query('BEGIN')
    await gate.query(`SELECT pg_advisory_xact_lock($1, $2)`, [GATE_K1, GATE_K2])
  }
  /** The backend that reached the gate and is waiting at it. */
  const atGate = (): Promise<number> => until('a writer at the gate', async () => {
    const r = await pool.query(
      `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = $2 AND NOT granted`, [GATE_K1, GATE_K2])
    return r.rows[0]?.pid as number | undefined
  })
  /** Some backend is queued behind `pid`. */
  const queuedBehind = (pid: number) => until('a writer queued behind the gated one', async () => {
    const r = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])
    return r.rows.length > 0
  })

  /** At the second exercise row of the session a rename updates: the first is already updated and locked. */
  const renamedRowGate = (sessionId: string) =>
    `NEW.session_id = '${sessionId}' AND NEW.exercise_name <> OLD.exercise_name AND EXISTS (
       SELECT 1 FROM session_exercises x WHERE x.session_id = NEW.session_id AND x.id <> NEW.id AND x.exercise_name = NEW.exercise_name)`

  const lib = async (name: string) => {
    const id = (await pool.query(
      `INSERT INTO exercise_library (name, equipment, muscles, created_by) VALUES ($1, ARRAY['barbell'], '[{"muscle":"chest","role":"main"}]'::jsonb, $2) RETURNING id`, [name, OWNER])).rows[0].id as string
    libIds.push(id)
    return id
  }
  const seedProgram = async (userId: string, names: string[], opts: { id?: string; plan?: boolean } = {}) => {
    const programId = opts.id ?? randomUUID()
    const sessionId = randomUUID()
    await pool.query(`INSERT INTO programs (id, user_id, name, phase_mode, is_active, training_goal) VALUES ($1,$2,$3,'ai_dynamic',false,'strength')`, [programId, userId, `P4096 ${programId}`])
    await pool.query(`INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1,$2,'Day',0)`, [sessionId, programId])
    const exercises: string[] = []
    for (const [i, n] of names.entries()) {
      exercises.push((await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,'primary','{chest}') RETURNING id`, [sessionId, n, i])).rows[0].id as string)
    }
    let planRow: string | null = null
    if (opts.plan) {
      planRow = (await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, baseline_complete) VALUES ($1,$2,'accumulation', now() - interval '30 days', true) RETURNING id`, [userId, sessionId])).rows[0].id as string
    }
    // The inserts stamp server time; pin it back so a later bump shows.
    await pool.query(`UPDATE programs SET updated_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [programId])
    return { programId, sessionId, exercises, planRow }
  }
  /** The editor's save, as the Config screen sends it: the program as listed, with a new name. */
  const editorSave = async (programId: string) => {
    const listed = (await repo.listPrograms(U1)).find(p => p.id === programId)!
    return repo.saveProgram(U1, { ...listed, name: `Edited ${programId.slice(0, 8)}` })
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    apply = await import('@/lib/coach/apply')
    await setGate({})
    await ddl(`CREATE TRIGGER ${FN}_ps BEFORE UPDATE ON programs FOR EACH STATEMENT EXECUTE FUNCTION ${FN}_ps()`)
    await ddl(`CREATE TRIGGER ${FN}_sp BEFORE UPDATE ON session_periodization FOR EACH STATEMENT EXECUTE FUNCTION ${FN}_sp()`)
    await ddl(`CREATE TRIGGER ${FN}_se BEFORE UPDATE ON session_exercises FOR EACH ROW EXECUTE FUNCTION ${FN}_se()`)
    for (const u of [OWNER, U1, U2]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [u, `q4096-${u}@example.com`, TZ])
    }
  })
  afterAll(async () => {
    await closeGate()
    if (!pool) return
    await ddl(`DROP TRIGGER IF EXISTS ${FN}_ps ON programs`).catch(() => undefined)
    await ddl(`DROP TRIGGER IF EXISTS ${FN}_sp ON session_periodization`).catch(() => undefined)
    await ddl(`DROP TRIGGER IF EXISTS ${FN}_se ON session_exercises`).catch(() => undefined)
    for (const s of ['ps', 'sp', 'se']) await pool.query(`DROP FUNCTION IF EXISTS ${FN}_${s}()`).catch(() => undefined)
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1::uuid[])`, [[U1, U2]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER, U1, U2]])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
  })
  beforeEach(async () => {
    await closeGate()
    await setGate({})
  })

  /**
   * One side (`writer`) is held between its two tables; the editor's save is started and waits until it is queued
   * behind the writer (or, with the order wrong, until it holds the program and is queued behind the exercise row);
   * then the gate opens. Neither may end in a deadlock, and both must commit.
   */
  const raceWithSave = async (writer: () => Promise<unknown>, save: () => Promise<unknown>) => {
    await holdGate()
    const w = writer().then(() => 'ok', e => e as Error)
    const pid = await atGate()
    const sv = save().then(() => 'ok', e => e as Error)
    await queuedBehind(pid)
    await closeGate()
    const [wr, sr] = await Promise.all([w, sv])
    return { wr, sr }
  }
  const expectBoth = (wr: unknown, sr: unknown) => {
    expect(code(wr), `writer: ${(wr as Error)?.message}`).toBeUndefined()
    expect(code(sr), `save: ${(sr as Error)?.message}`).toBeUndefined()
    expect(wr).toBe('ok')
    expect(sr).toBe('ok')
  }

  it('the creator\'s rename against the editor\'s save of a program that uses the exercise', async () => {
    const oldName = `Q4096 Old ${TAG} a`
    const newName = `Q4096 New ${TAG} a`
    const entryId = await lib(oldName)
    const p = await seedProgram(U1, [oldName, oldName, oldName])
    await setGate({ exerciseRow: renamedRowGate(p.sessionId) })
    const { wr, sr } = await raceWithSave(() => repo.renameExercise(OWNER, entryId, newName), () => editorSave(p.programId))
    expectBoth(wr, sr)
  })

  it('the admin\'s rename (the other route) against the editor\'s save', async () => {
    const oldName = `Q4096 Old ${TAG} b`
    const newName = `Q4096 New ${TAG} b`
    const entryId = await lib(oldName)
    const p = await seedProgram(U1, [oldName, oldName])
    await setGate({ exerciseRow: renamedRowGate(p.sessionId) })
    const { wr, sr } = await raceWithSave(
      () => repo.adminUpdateExercise({ id: entryId, name: newName, muscles: [], equipment: [] }), () => editorSave(p.programId))
    expectBoth(wr, sr)
  })

  it('the Coach removing a session exercise against the editor\'s save of that program', async () => {
    const p = await seedProgram(U1, [`Q4096 Fly ${TAG}`, `Q4096 Curl ${TAG}`])
    // Only the Coach's own transaction can see its uncommitted tombstone.
    await setGate({ programStmt: `EXISTS (SELECT 1 FROM session_exercises WHERE id = '${p.exercises[0]}' AND deleted_at IS NOT NULL)` })
    const { wr, sr } = await raceWithSave(
      () => apply.applyCoachPatch(db, U1,
        { domain: 'session_exercise', targetId: p.exercises[0], changes: [{ id: 'c', field: 'removed', from: false, to: true }] } as never, ['c'], '2026-11-22', TZ)
        .then(o => { if (!(o as { ok: boolean }).ok) throw new Error(JSON.stringify(o)) }),
      () => editorSave(p.programId))
    expectBoth(wr, sr)
  })

  it('the Coach swapping a session exercise for another, with a stored plan, against the editor\'s save', async () => {
    const from = `Q4096 Press ${TAG}`
    const to = `Q4096 Dip ${TAG}`
    await lib(to)
    const p = await seedProgram(U1, [from, `Q4096 Row ${TAG}`], { plan: true })
    await setGate({ planStmt: `EXISTS (SELECT 1 FROM session_exercises WHERE id = '${p.exercises[0]}' AND exercise_name = '${to}')` })
    const { wr, sr } = await raceWithSave(
      () => apply.applyCoachPatch(db, U1,
        { domain: 'session_exercise', targetId: p.exercises[0], changes: [{ id: 'c', field: 'exerciseName', from, to }] } as never, ['c'], '2026-11-22', TZ)
        .then(o => { if (!(o as { ok: boolean }).ok) throw new Error(JSON.stringify(o)) }),
      () => editorSave(p.programId))
    expectBoth(wr, sr)
  })

  it('a rename behind a program lock held from another connection ends as a bounded busy, with nothing written (#4157)', async () => {
    const { lockWait } = await import('@/lib/coach/lock-wait')
    const { isBoundedLockTimeout } = await import('@/lib/api/route-errors')
    const oldName = `Q4096 Old ${TAG} w`
    const newName = `Q4096 New ${TAG} w`
    const entryId = await lib(oldName)
    const p = await seedProgram(U1, [oldName, oldName])
    const before = lockWait.ms
    lockWait.ms = 300 // the real bound is 4 s; the object exists so a test can shorten it
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT id FROM programs WHERE id = $1 FOR NO KEY UPDATE`, [p.programId])
      for (const attempt of [
        () => repo.renameExercise(OWNER, entryId, newName),
        () => repo.adminUpdateExercise({ id: entryId, name: newName, muscles: [], equipment: [] }),
      ]) {
        const started = Date.now()
        const err = await attempt().then(() => null, e => e as Error)
        const took = Date.now() - started
        expect(err, 'the rename should not have succeeded behind the lock').not.toBeNull()
        expect(code(err), `${err?.message}`).toBe('55P03') // the bounded wait, not 57014 (statement timeout) or 40P01
        expect(isBoundedLockTimeout(err)).toBe(true)
        expect(took).toBeGreaterThanOrEqual(250)
        expect(took).toBeLessThan(3_000)
      }
    } finally {
      lockWait.ms = before
      await holder.query('ROLLBACK').catch(() => undefined)
      holder.release()
    }
    // Nothing half-written: the exercise rows and the library row keep the old name.
    const names = (await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = ANY($1::uuid[])`, [p.exercises])).rows.map(r => r.exercise_name)
    expect(names).toEqual([oldName, oldName])
    expect((await pool.query(`SELECT name FROM exercise_library WHERE id = $1`, [entryId])).rows[0].name).toBe(oldName)
    // Free again, the same rename goes through.
    await repo.renameExercise(OWNER, entryId, newName)
    expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [p.exercises[0]])).rows[0].exercise_name).toBe(newName)
  })

  it('two renames that share programs lock them in id order before touching an exercise row', async () => {
    // Two programs of two different people; the LOWER id is locked first, whoever owns it.
    const [lowId, highId] = [randomUUID(), randomUUID()].sort()
    const oldName = `Q4096 Old ${TAG} c`
    const newName = `Q4096 New ${TAG} c`
    const entryId = await lib(oldName)
    const low = await seedProgram(U1, [oldName], { id: lowId })
    const high = await seedProgram(U2, [oldName], { id: highId })
    // The test holds the HIGHER program from outside; the rename must be holding the lower one, having changed no
    // exercise row, while it waits for it.
    const blocker = await pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query(`SELECT id FROM programs WHERE id = $1 FOR NO KEY UPDATE`, [high.programId])
      const rename = repo.renameExercise(OWNER, entryId, newName).then(() => 'ok', e => e as Error)
      const probe = await pool.connect()
      try {
        await until('the rename to hold the lower program and wait for the higher', async () => {
          await probe.query('BEGIN')
          try {
            await probe.query(`SELECT id FROM programs WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, [low.programId])
            return null // free: the rename has not taken it yet
          } catch (e) {
            return code(e) === '55P03'
          } finally {
            await probe.query('ROLLBACK')
          }
        })
        // No exercise row is held: the rename has not changed one yet.
        await probe.query('BEGIN')
        try {
          const r = await probe.query(`SELECT id FROM session_exercises WHERE id = ANY($1::uuid[]) FOR NO KEY UPDATE NOWAIT`, [[...low.exercises, ...high.exercises]])
          expect(r.rows).toHaveLength(2)
        } finally {
          await probe.query('ROLLBACK')
        }
      } finally {
        probe.release()
      }
      await blocker.query('COMMIT')
      expect(await rename).toBe('ok')
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
    }
    const left = await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = ANY($1::uuid[])`, [[...low.exercises, ...high.exercises]])
    expect(left.rows.map(r => r.exercise_name)).toEqual([newName, newName])
  })

  it('two renames over programs they share, started together, never deadlock (20 rounds)', async () => {
    const outcomes: string[] = []
    for (let round = 0; round < 20; round++) {
      const a = `Q4096 A${round} ${TAG}`
      const b = `Q4096 B${round} ${TAG}`
      const ea = await lib(a)
      const eb = await lib(b)
      for (let i = 0; i < 4; i++) await seedProgram(i % 2 ? U1 : U2, [a, b])
      const results = await Promise.all([
        repo.renameExercise(OWNER, ea, `${a} renamed`).then(() => 'ok', e => e as Error),
        repo.renameExercise(OWNER, eb, `${b} renamed`).then(() => 'ok', e => e as Error),
      ])
      for (const r of results) outcomes.push(r === 'ok' ? 'ok' : `${code(r)}: ${(r as Error).message}`)
      await pool.query(`DELETE FROM programs WHERE user_id = ANY($1::uuid[])`, [[U1, U2]])
    }
    expect(outcomes.filter(o => o !== 'ok')).toEqual([])
  })

  it('a rename changes exactly the exercise rows with the old name, bumps exactly their programs, and nothing else', async () => {
    const oldName = `Q4096 Old ${TAG} d`
    const newName = `Q4096 New ${TAG} d`
    const entryId = await lib(oldName)
    const using: string[] = []
    const notUsing: string[] = []
    for (let i = 0; i < 50; i++) {
      const uses = i % 5 !== 4
      const p = await seedProgram(i % 2 ? U1 : U2, uses ? [oldName, `Q4096 keep ${i}`, oldName] : [`Q4096 keep ${i}`])
      ;(uses ? using : notUsing).push(p.programId)
    }
    const t0 = Date.now()
    await repo.renameExercise(OWNER, entryId, newName)
    const ms = Date.now() - t0
    process.stderr.write(`[#4096] rename over ${using.length} programs: ${ms} ms\n`)
    const pinned = Date.parse('2026-01-01T00:00:00Z')
    const stamps = async (ids: string[]) => (await pool.query(`SELECT updated_at FROM programs WHERE id = ANY($1::uuid[])`, [ids])).rows.map(r => new Date(r.updated_at).getTime())
    expect((await stamps(using)).every(t => t > pinned)).toBe(true)
    expect((await stamps(notUsing)).every(t => t === pinned)).toBe(true)
    const names = await pool.query(
      `SELECT se.exercise_name, count(*)::int AS n FROM session_exercises se JOIN program_sessions ps ON ps.id = se.session_id
        WHERE ps.program_id = ANY($1::uuid[]) GROUP BY 1`, [[...using, ...notUsing]])
    const byName = Object.fromEntries(names.rows.map(r => [r.exercise_name, r.n]))
    expect(byName[newName]).toBe(using.length * 2)
    expect(byName[oldName]).toBeUndefined()
  })
})

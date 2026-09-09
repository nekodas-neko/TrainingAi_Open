// LB-66: removing a training session from a program used to be a hard DELETE. There is no delete
// endpoint for one — removal is expressed as saving the program without it — so the whole thing
// hangs off `saveProgram` telling "did not come back" apart from "came back and was rebuilt".
//
// The cases below are split along what each half of the change is actually load-bearing for:
// the tombstone itself, the two FKs it stops firing (workout links, periodization state), the
// partial unique index that makes a tombstone able to coexist with the compacted survivors, the
// read filters, and the delta channel that carries the removal to other devices.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import type { Program } from '@trainingai/shared/types'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-0000000015a0'

describe.skipIf(!canRun)('a removed program session is tombstoned, not deleted (LB-66)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let prog: typeof import('@/lib/data/postgres/slices/programs')
  let periodization: typeof import('@/lib/data/postgres/slices/periodization')
  let programId: string

  const sid = (n: number) => `00000000-0000-4000-8000-0000000015a${n}`

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    prog = await import('@/lib/data/postgres/slices/programs')
    periodization = await import('@/lib/data/postgres/slices/periodization')
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `lb66-${TEST_USER_ID}@example.com`],
    )
  })

  afterEach(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM session_periodization WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  /** A program payload in the shape `saveProgram` takes, with N sessions at compacted positions. */
  function payload(sessions: { id: string; name: string }[], id?: string): Program {
    return {
      id: id ?? '',
      userId: TEST_USER_ID,
      name: 'LB-66 Program',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      sessions: sessions.map((sess, i) => ({
        id: sess.id,
        programId: id ?? '',
        name: sess.name,
        position: i,
        exercises: [{
          id: undefined,
          sessionId: sess.id,
          exerciseName: `${sess.name} Press`,
          muscleGroups: ['chest'],
          position: 0,
          exerciseRole: 'primary' as const,
        }],
      })),
    } as unknown as Program
  }

  /** Three sessions saved, then the middle one removed — the shape every case below starts from. */
  async function saveThenRemoveMiddle() {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' }, { id: sid(3), name: 'Charlie' },
    ]))
    programId = saved.id
    await prog.saveProgram(db, TEST_USER_ID, payload(
      [{ id: sid(1), name: 'Alpha' }, { id: sid(3), name: 'Charlie' }], programId,
    ))
    return programId
  }

  it('keeps the removed row with a deleted_at, and tombstones its exercises with it', async () => {
    await saveThenRemoveMiddle()
    const { rows } = await pool.query(
      `SELECT id, deleted_at FROM program_sessions WHERE program_id = $1 ORDER BY position`,
      [programId],
    )
    expect(rows).toHaveLength(3)
    expect(rows.filter(r => r.deleted_at === null).map(r => r.id).sort()).toEqual([sid(1), sid(3)].sort())
    const tombstoned = rows.find(r => r.id === sid(2))
    expect(tombstoned?.deleted_at).toBeInstanceOf(Date)

    const ex = await pool.query(
      `SELECT deleted_at FROM session_exercises WHERE session_id = $1`, [sid(2)],
    )
    expect(ex.rows).toHaveLength(1)
    expect(ex.rows[0].deleted_at).toBeInstanceOf(Date)
  })

  it('removing a middle session does not collide with the compacted survivors', async () => {
    // The reason this is a constraint swap and not a plain ADD COLUMN: the tombstone keeps
    // position 1, and Charlie moves into position 1 on the same save. Under the old
    // `(program_id, position)` UNIQUE this save is a 23505.
    await expect(saveThenRemoveMiddle()).resolves.toBeTruthy()
    const { rows } = await pool.query(
      `SELECT position, deleted_at IS NULL AS live FROM program_sessions
       WHERE program_id = $1 AND position = 1 ORDER BY live`,
      [programId],
    )
    expect(rows.map(r => r.live)).toEqual([false, true])
  })

  it('leaves already-logged workouts pointing at the session they were trained under', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' },
    ]))
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, program_session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, $2, 'Bravo', now(), now())`,
      [TEST_USER_ID, sid(2)],
    )
    await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(1), name: 'Alpha' }], saved.id))

    // Both FKs are ON DELETE SET NULL, so the hard delete used to blank both columns and the
    // workout lost the session it belonged to.
    const { rows } = await pool.query(
      `SELECT session_id, program_session_id FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID],
    )
    expect(rows[0].session_id).toBe(sid(2))
    expect(rows[0].program_session_id).toBe(sid(2))
  })

  it('keeps the removed session periodization row, and stops listing it for the program', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' },
    ]))
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase)
       VALUES ($1, $2, 'accumulation', 4)`,
      [TEST_USER_ID, sid(2)],
    )
    await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(1), name: 'Alpha' }], saved.id))

    // ON DELETE CASCADE used to destroy this outright.
    const kept = await pool.query(
      `SELECT sessions_in_phase FROM session_periodization WHERE program_session_id = $1`, [sid(2)],
    )
    expect(kept.rows).toHaveLength(1)
    expect(kept.rows[0].sessions_in_phase).toBe(4)

    // ...but it is no longer part of the program's state, so nothing reads it back.
    const listed = await periodization.listSessionPeriodizationForProgram(db, TEST_USER_ID, saved.id)
    expect(listed.map(r => r.programSessionId)).not.toContain(sid(2))
  })

  it('hides the tombstoned session and its exercises from the program read', async () => {
    await saveThenRemoveMiddle()
    const [program] = (await prog.listPrograms(db, TEST_USER_ID)).filter(p => p.id === programId)
    expect(program.sessions.map(sess => sess.id)).toEqual([sid(1), sid(3)])
    expect(program.sessions.flatMap(sess => sess.exercises).map(e => e.exerciseName))
      .toEqual(['Alpha Press', 'Charlie Press'])
  })

  it('clears a schedule day that pointed at the removed session', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, {
      ...payload([{ id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' }]),
      schedule: { type: 'weekly', days: [{ dayOfWeek: 1, sessionId: sid(2) }] },
    } as unknown as Program)
    const before = await pool.query(
      `SELECT session_id FROM schedule_days sd JOIN schedules s ON s.id = sd.schedule_id
       WHERE s.program_id = $1`, [saved.id],
    )
    expect(before.rows[0].session_id).toBe(sid(2))

    // A stale client can still name the session it is removing in the same save; the FK used to
    // null the slot on delete and no longer fires.
    await prog.saveProgram(db, TEST_USER_ID, {
      ...payload([{ id: sid(1), name: 'Alpha' }], saved.id),
      schedule: { type: 'weekly', days: [{ dayOfWeek: 1, sessionId: sid(2) }] },
    } as unknown as Program)
    const after = await pool.query(
      `SELECT session_id FROM schedule_days sd JOIN schedules s ON s.id = sd.schedule_id
       WHERE s.program_id = $1`, [saved.id],
    )
    expect(after.rows[0].session_id).toBeNull()
  })

  it('clears a schedule day even when the save carries no schedule at all', async () => {
    // The sibling case above goes through the schedule REBUILD, which filters the removed id out
    // of the re-insert. A save that omits `schedule` skips that block entirely, and then the
    // explicit clear is the only thing standing in for the FK.
    const saved = await prog.saveProgram(db, TEST_USER_ID, {
      ...payload([{ id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' }]),
      schedule: { type: 'weekly', days: [{ dayOfWeek: 1, sessionId: sid(2) }] },
    } as unknown as Program)
    await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(1), name: 'Alpha' }], saved.id))
    const after = await pool.query(
      `SELECT session_id FROM schedule_days sd JOIN schedules s ON s.id = sd.schedule_id
       WHERE s.program_id = $1`, [saved.id],
    )
    expect(after.rows).toHaveLength(1)
    expect(after.rows[0].session_id).toBeNull()
  })

  it('hides an exercise tombstoned on its own, under a session that is still live', async () => {
    // Not covered by the whole-session case: there the exercises are unreachable anyway, because
    // their session is already filtered out one query earlier.
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(1), name: 'Alpha' }]))
    const [ex] = (await prog.listPrograms(db, TEST_USER_ID)).find(p => p.id === saved.id)!.sessions[0].exercises
    await prog.removeSessionExercise(db, TEST_USER_ID, ex.id!)

    const [program] = (await prog.listPrograms(db, TEST_USER_ID)).filter(p => p.id === saved.id)
    expect(program.sessions).toHaveLength(1)
    expect(program.sessions[0].exercises).toEqual([])
  })

  it('does not re-point a removed session\'s workouts onto whichever session took its slot', async () => {
    // Removing position 0 compacts the survivor into position 0, and the pre-id position fallback
    // maps old-slot to new-slot — so a capture that still included the removed session would
    // re-attribute its workouts to a completely different session rather than leave them be.
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' },
    ]))
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, program_session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, $2, 'Alpha', now(), now())`,
      [TEST_USER_ID, sid(1)],
    )
    await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(2), name: 'Bravo' }], saved.id))

    const { rows } = await pool.query(
      `SELECT session_id, program_session_id FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID],
    )
    expect(rows[0].program_session_id).toBe(sid(1))
    expect(rows[0].session_id).toBe(sid(1))
  })

  it('tombstones nothing when every session comes back', async () => {
    // The failure the entry as written would have shipped: soft-deleting the replace-all would
    // tombstone the whole program on every save, including a rename that removes nothing.
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' },
    ]))
    await prog.saveProgram(db, TEST_USER_ID, payload(
      [{ id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Renamed' }], saved.id,
    ))
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM program_sessions WHERE program_id = $1 AND deleted_at IS NOT NULL`,
      [saved.id],
    )
    expect(rows[0].n).toBe(0)
  })

  it('resurrects a tombstoned session when its id is saved back, rather than calling it foreign', async () => {
    const programId = await saveThenRemoveMiddle()
    // `sid(2)` still exists under this program, so the "belongs to another program" guard must
    // not fire on it — and the row has to be hard-deleted before it can be re-inserted on the
    // same primary key.
    const restored = await prog.saveProgram(db, TEST_USER_ID, payload([
      { id: sid(1), name: 'Alpha' }, { id: sid(2), name: 'Bravo' }, { id: sid(3), name: 'Charlie' },
    ], programId))
    expect(restored.sessions.map(sess => sess.id)).toEqual([sid(1), sid(2), sid(3)])
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM program_sessions WHERE program_id = $1 AND deleted_at IS NOT NULL`,
      [programId],
    )
    expect(rows[0].n).toBe(0)
  })

  it('does not resolve a legacy null-session_id workout to a tombstoned session by name', async () => {
    const programId = await saveThenRemoveMiddle()
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at)
       VALUES ($1, NULL, 'Bravo', now(), now())`,
      [TEST_USER_ID],
    )
    const counts = await prog.countAllSessionsSinceStart(db, TEST_USER_ID, programId)
    expect(counts.has(sid(2))).toBe(false)
  })

  it('carries the removal to other devices as an absence in the changed subtree', async () => {
    const since = new Date(Date.now() - 60_000)
    const programId = await saveThenRemoveMiddle()
    const { PostgresWorkoutRepository } = await import("@/lib/data/postgres/adapter")
    const delta = await new PostgresWorkoutRepository().getSyncDelta(TEST_USER_ID, since)

    // The client deletes every child of a changed program before re-inserting what arrives, so
    // the removal propagates as the tombstone simply not being in the replacement. That only
    // works while the program itself is in the delta.
    expect((delta.programs as { id: string }[]).map(p => p.id)).toContain(programId)
    expect((delta.programSessions as { id: string }[]).map(r => r.id).sort())
      .toEqual([sid(1), sid(3)].sort())
    expect((delta.sessionExercises as { sessionId: string }[]).map(r => r.sessionId))
      .not.toContain(sid(2))
  })

  it('tombstones a single removed exercise and bumps the program so the delta carries it', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload([{ id: sid(1), name: 'Alpha' }]))
    const [ex] = (await prog.listPrograms(db, TEST_USER_ID)).find(p => p.id === saved.id)!.sessions[0].exercises
    await pool.query(`UPDATE programs SET updated_at = now() - interval '1 hour' WHERE id = $1`, [saved.id])

    expect(await prog.removeSessionExercise(db, TEST_USER_ID, ex.id!)).toBe(true)

    const row = await pool.query(`SELECT deleted_at FROM session_exercises WHERE id = $1`, [ex.id])
    expect(row.rows[0].deleted_at).toBeInstanceOf(Date)
    // Without the bump the program never re-enters the pull delta, so the removal would reach
    // no other device at all — the tombstone would be strictly worse than the hard delete.
    const bumped = await pool.query(
      `SELECT updated_at > now() - interval '1 minute' AS fresh FROM programs WHERE id = $1`, [saved.id],
    )
    expect(bumped.rows[0].fresh).toBe(true)
    // Idempotent: the row is no longer reachable, so a repeat is a miss rather than a second write.
    expect(await prog.removeSessionExercise(db, TEST_USER_ID, ex.id!)).toBe(false)
  })
})

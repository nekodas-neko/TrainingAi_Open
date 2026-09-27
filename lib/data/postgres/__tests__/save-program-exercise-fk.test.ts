// RV-168: `session_exercises.exercise_id` is the catalogue join key migration 099 introduced and
// backfilled — and every program save wiped it straight back to NULL, because a save is a
// delete + re-insert and the insert never carried the column. Only the Coach swap wrote it, which
// is why production had 0 of 25 on the active program and 1-2 strays on the others.
//
// The cases below pin the resolution semantics to migration 099's exactly (exact, case-sensitive
// match on the library's unique name) and pin the re-save, which is the shape that actually
// regressed: one save filling the column proves nothing if the next one empties it again.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import type { Program } from '@trainingai/shared/types'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-0000000168a0'
const LIB_SQUAT = '00000000-0000-4000-8000-0000000168b1'
const LIB_BENCH = '00000000-0000-4000-8000-0000000168b2'

describe.skipIf(!canRun)('saveProgram fills the catalogue FK (RV-168)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let prog: typeof import('@/lib/data/postgres/slices/programs')

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    prog = await import('@/lib/data/postgres/slices/programs')
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `rv168-${TEST_USER_ID}@example.com`],
    )
    for (const [id, name] of [[LIB_SQUAT, 'RV168 Barbell Squat'], [LIB_BENCH, 'RV168 Bench Press']]) {
      await pool.query(
        `INSERT INTO exercise_library (id, name, muscles) VALUES ($1, $2, '[]'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, name],
      )
    }
  })

  afterEach(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [[LIB_SQUAT, LIB_BENCH]])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  /** A one-session program in the shape `saveProgram` takes, carrying the given exercise names. */
  function payload(names: string[], id?: string, sessionId?: string): Program {
    return {
      id: id ?? '',
      userId: TEST_USER_ID,
      name: 'RV-168 Program',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      sessions: [{
        id: sessionId,
        programId: id ?? '',
        name: 'Day 1',
        position: 0,
        exercises: names.map((exerciseName, i) => ({
          id: undefined,
          sessionId,
          exerciseName,
          muscleGroups: ['quads'],
          position: i,
          exerciseRole: 'primary' as const,
        })),
      }],
    } as unknown as Program
  }

  /** `exercise_name → exercise_id` for the program's live rows. */
  async function fks(programId: string): Promise<Record<string, string | null>> {
    const { rows } = await pool.query(
      `SELECT se.exercise_name, se.exercise_id
         FROM session_exercises se
         JOIN program_sessions ps ON ps.id = se.session_id
        WHERE ps.program_id = $1 AND se.deleted_at IS NULL`,
      [programId],
    )
    return Object.fromEntries(rows.map(r => [r.exercise_name, r.exercise_id]))
  }

  it('links an exercise whose name is in the library', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload(['RV168 Barbell Squat']))
    expect(await fks(saved.id)).toEqual({ 'RV168 Barbell Squat': LIB_SQUAT })
  })

  it('links each name to its own catalogue row, not the first one found', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID,
      payload(['RV168 Bench Press', 'RV168 Barbell Squat']))
    expect(await fks(saved.id)).toEqual({
      'RV168 Bench Press': LIB_BENCH,
      'RV168 Barbell Squat': LIB_SQUAT,
    })
  })

  it('leaves a name the library does not have as NULL rather than guessing', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID,
      payload(['RV168 Barbell Squat', 'Some Freeform Movement']))
    expect(await fks(saved.id)).toEqual({
      'RV168 Barbell Squat': LIB_SQUAT,
      'Some Freeform Movement': null,
    })
  })

  it('matches case-sensitively, as migration 099 backfilled it', async () => {
    const saved = await prog.saveProgram(db, TEST_USER_ID, payload(['rv168 barbell squat']))
    expect(await fks(saved.id)).toEqual({ 'rv168 barbell squat': null })
  })

  // The regression itself. The first save was never the problem: production had rows written by
  // the Coach and then emptied by the next save of the same program.
  it('still has the FK after a re-save, which is the delete + re-insert path', async () => {
    const first = await prog.saveProgram(db, TEST_USER_ID, payload(['RV168 Barbell Squat']))
    const sessionId = first.sessions[0].id
    expect(await fks(first.id)).toEqual({ 'RV168 Barbell Squat': LIB_SQUAT })

    const second = await prog.saveProgram(db, TEST_USER_ID,
      payload(['RV168 Barbell Squat', 'RV168 Bench Press'], first.id, sessionId))
    expect(second.id).toBe(first.id)
    expect(await fks(first.id)).toEqual({
      'RV168 Barbell Squat': LIB_SQUAT,
      'RV168 Bench Press': LIB_BENCH,
    })
  })
})

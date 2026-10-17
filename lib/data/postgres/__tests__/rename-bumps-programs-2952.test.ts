// Issue 2952: renaming an exercise rewrites `session_exercises`, and the delta re-sends a program's
// subtree only when `programs.updated_at` moved. So both rename paths move it on every program that
// uses the exercise, and on no other.
//
// DB-backed, driven through the repository and `getSyncDelta`, because what matters is the real
// statement and the delta's own selection of program structure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002952'
const OTHER = '00000000-0000-4000-8000-000000012952'

describe.skipIf(!canRun)('an exercise rename moves updated_at on the programs that use it (issue 2952)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  /** A program with one session holding `exercises`, stamped in the past so any bump shows. */
  async function program(userId: string, exercises: string[]) {
    const programId = randomUUID()
    const sessionId = randomUUID()
    await pool.query(
      `INSERT INTO programs (id, user_id, name, updated_at) VALUES ($1, $2, $3, '2026-01-01T00:00:00Z')`,
      [programId, userId, `P 2952 ${programId}`],
    )
    await pool.query(`INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'A', 0)`, [sessionId, programId])
    for (const [i, name] of exercises.entries()) {
      await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, $2, $3)`,
        [sessionId, name, i],
      )
    }
    // The insert trigger stamps server time; pin it back so the test sees the rename's bump alone.
    await pool.query(`UPDATE programs SET updated_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [programId])
    return programId
  }
  const updatedAt = async (programId: string) =>
    new Date((await pool.query(`SELECT updated_at FROM programs WHERE id = $1`, [programId])).rows[0].updated_at).getTime()
  const PINNED = Date.parse('2026-01-01T00:00:00Z')

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-2952-${id}@example.com`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id IN ($1, $2)`, [USER, OTHER])
    await pool.query(`DELETE FROM exercise_library WHERE created_by = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [USER, OTHER])
  })

  it('renameExercise bumps the program using it, and the delta now carries its renamed row', async () => {
    const entry = await repo.createExercise({ name: 'Rename 2952 Old A', muscles: [], equipment: [], createdBy: USER })
    const using = await program(USER, ['Rename 2952 Old A', 'Rename 2952 Other A'])
    const notUsing = await program(USER, ['Rename 2952 Other A'])
    const cursor = new Date()

    await repo.renameExercise(USER, entry.id, 'Rename 2952 New A')

    expect(await updatedAt(using)).toBeGreaterThan(PINNED)
    expect(await updatedAt(notUsing)).toBe(PINNED)

    const delta = await repo.getSyncDelta(USER, cursor)
    const programIds = (delta.programs as Array<{ id: string }>).map(p => p.id)
    expect(programIds).toContain(using)
    expect(programIds).not.toContain(notUsing)
    const names = (delta.sessionExercises as Array<{ exerciseName: string }>).map(e => e.exerciseName)
    expect(names).toEqual(expect.arrayContaining(['Rename 2952 New A', 'Rename 2952 Other A']))
    expect(names).not.toContain('Rename 2952 Old A')
  })

  it('adminUpdateExercise bumps only the programs using it', async () => {
    const entry = await repo.createExercise({ name: 'Rename 2952 Old B', muscles: [], equipment: [], createdBy: USER })
    const using = await program(USER, ['Rename 2952 Old B'])
    const notUsing = await program(USER, ['Rename 2952 Other B'])

    await repo.adminUpdateExercise({ id: entry.id, name: 'Rename 2952 New B', muscles: [], equipment: [] })

    expect(await updatedAt(using)).toBeGreaterThan(PINNED)
    expect(await updatedAt(notUsing)).toBe(PINNED)
  })

  it('an edit that keeps the name bumps nothing', async () => {
    const entry = await repo.createExercise({ name: 'Rename 2952 Same C', muscles: [], equipment: [], createdBy: USER })
    const using = await program(USER, ['Rename 2952 Same C'])

    await repo.adminUpdateExercise({ id: entry.id, name: 'Rename 2952 Same C', muscles: [], equipment: ['barbell'] })

    expect(await updatedAt(using)).toBe(PINNED)
  })

  it("bumps another user's program whose row the rename rewrote, so their phone gets the new name too", async () => {
    // The library is shared and the rewrite is by name, so the rename already changed this
    // program's row; leaving its stamp alone would leave that user's mirror stale.
    const entry = await repo.createExercise({ name: 'Rename 2952 Old D', muscles: [], equipment: [], createdBy: USER })
    const theirs = await program(OTHER, ['Rename 2952 Old D'])
    const theirsNotUsing = await program(OTHER, ['Rename 2952 Other D'])

    await repo.renameExercise(USER, entry.id, 'Rename 2952 New D')

    expect(await updatedAt(theirs)).toBeGreaterThan(PINNED)
    expect(await updatedAt(theirsNotUsing)).toBe(PINNED)
  })
})

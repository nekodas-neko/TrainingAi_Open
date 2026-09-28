// BF-217 — a program save must not blank an exercise's progression style.
//
// The owner's active program carries nine exercises with no style, and the entry suspected a save
// path writing NULL over a style that was set. Reading every writer of `session_exercises.style_id`
// found none that does, provided the caller sends the field. This pins the two shapes that matter:
// the Config activation call, which spreads the program exactly as `listPrograms` returned it, and a
// second save of the same payload. Both must keep every style.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000217a01'

describe.skipIf(!canRun)('a program re-save keeps every exercise style (BF-217)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let styleA: string
  let styleB: string

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'bf217@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    styleA = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, 'BF217 A') RETURNING id`, [USER])).rows[0].id
    styleB = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, 'BF217 B') RETURNING id`, [USER])).rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const stylesOf = async (programId: string) => (await pool.query(
    `SELECT se.exercise_name, se.style_id FROM session_exercises se
       JOIN program_sessions ps ON ps.id = se.session_id
      WHERE ps.program_id = $1 AND se.deleted_at IS NULL ORDER BY se.exercise_name`, [programId])).rows

  it('keeps styles through an activation-shaped re-save and a repeated save', async () => {
    const created = await repo.saveProgram(USER, {
      id: '', userId: USER, name: 'BF217 Program', isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
      sessions: [{
        id: crypto.randomUUID(), name: 'Lower', position: 0,
        exercises: [
          { exerciseName: 'Barbell Hip Thrust', styleId: styleA, muscleGroups: ['glutes'], position: 0, exerciseRole: 'primary' },
          { exerciseName: 'Hanging Leg Raise', styleId: styleB, muscleGroups: ['abs'], position: 1, exerciseRole: 'accessory' },
        ],
      }],
    } as never)
    const before = await stylesOf(created.id)
    expect(before.map(r => r.style_id)).toEqual([styleA, styleB])

    // Config's activateProgram: `{ ...program, isActive: true }` from the list read.
    const listed = (await repo.listPrograms(USER)).find(p => p.id === created.id)!
    await repo.saveProgram(USER, { ...listed, isActive: true })
    expect(await stylesOf(created.id)).toEqual(before)

    // And again, from the result of that save.
    const again = (await repo.listPrograms(USER)).find(p => p.id === created.id)!
    await repo.saveProgram(USER, again)
    expect(await stylesOf(created.id)).toEqual(before)
  })
})

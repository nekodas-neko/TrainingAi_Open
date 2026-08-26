// Q-403 — the Coach's exercise swap edits the PROGRAM, and the confirmation card never said so.
//
// The owner asked what it did, and on being told they did not want it as it stood: *"You dont want
// to be changing excercises during a program or you will lose progress for it — plus for some people
// it would be hard to learn a new movement."* The information they were missing is that this is not
// a change for today: it applies to every future run of that session, and progression history on the
// outgoing lift stops advancing.
//
// **This is asserted on the CARD rather than in the system prompt on purpose.** Q-403's own
// investigation measured the prompt's existing ordering instruction being ignored 3 times out of 3.
// A consequence rendered from the patch cannot be ignored, forgotten, or reworded by the model.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000403'

describe.skipIf(!canRun)('a Coach swap says it changes the program (Q-403)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let handler: typeof import('@/lib/coach/domains/session-exercise').sessionExerciseHandler
  let targetId: string

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    handler = (await import('@/lib/coach/domains/session-exercise')).sessionExerciseHandler
    pool = getPool(); db = await getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `q403-${TEST_USER_ID}@example.com`])
    await pool.query(
      `INSERT INTO exercise_library (name, muscles, equipment)
       VALUES ('Q403 Barbell Bench Press', $1::jsonb, ARRAY['barbell'])
       ON CONFLICT (name) DO NOTHING`,
      [JSON.stringify([{ muscle: 'chest', role: 'main' }])])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM programs WHERE user_id=$1', [TEST_USER_ID])
    const p = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1,'Q403 Program') RETURNING id`, [TEST_USER_ID])
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Legs',0) RETURNING id`,
      [p.rows[0].id])
    const se = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, muscle_groups, exercise_role)
       VALUES ($1,'Q403 Romanian Deadlift',0,ARRAY['hamstrings'],'secondary') RETURNING id`,
      [ps.rows[0].id])
    targetId = se.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM programs WHERE user_id=$1', [TEST_USER_ID])
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE 'Q403 %'`)
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  const previewSwap = () => handler.preview(db, TEST_USER_ID, {
    targetId,
    changes: [{ field: 'exerciseName', from: 'Q403 Romanian Deadlift', to: 'Q403 Barbell Bench Press' }],
  } as never)

  it('warns that the change applies beyond today, naming the session', async () => {
    const { consequences } = await previewSwap()
    const warn = consequences.find(c => c.kind === 'warn' && /not just today/i.test(c.text))
    expect(warn).toBeDefined()
    expect(warn!.text).toContain('Legs')          // the session it will change, by name
    expect(warn!.text).toMatch(/from now on/i)
  })

  it('names the lift whose progression history stops advancing', async () => {
    const { consequences } = await previewSwap()
    const warn = consequences.find(c => /Progression history/i.test(c.text))!
    expect(warn.text).toContain('Q403 Romanian Deadlift')
  })

  // The owner's one-off case has a non-destructive answer already — the in-workout injury swap,
  // which mutates local state only. Pointing at it is what makes the warning actionable rather than
  // just discouraging.
  it('points at the in-workout swap for a change that should only last today', async () => {
    const { consequences } = await previewSwap()
    expect(consequences.some(c => /inside the workout/i.test(c.text))).toBe(true)
  })

  it('warns on a removal too, not only a swap', async () => {
    const { consequences } = await handler.preview(db, TEST_USER_ID, {
      targetId, changes: [{ field: 'removed', from: false, to: true }],
    } as never)
    expect(consequences.some(c => c.kind === 'warn' && /not just today/i.test(c.text))).toBe(true)
  })

  // A patch that changes neither should not lecture the user about permanence.
  it('does not warn when nothing is being swapped or removed', async () => {
    const { consequences } = await handler.preview(db, TEST_USER_ID, {
      targetId, changes: [{ field: 'position', from: 0, to: 1 }],
    } as never)
    expect(consequences.some(c => /not just today/i.test(c.text))).toBe(false)
  })
})

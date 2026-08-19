// Q-405 — a Coach swap carried the OUTGOING exercise's role onto the incoming one. `exercise_role`
// selects the progression style, so the role decides the prescribed percentages and sets: the
// owner's Barbell Romanian Deadlift → Barbell Jefferson Curl swap kept `secondary` and prescribed
// 60 kg x 6 at 80% on a slow spinal-flexion movement.
//
// The recommender itself has its own unit tests. This pins the WRITE PATH, which is what silently
// inherited — including the case the owner actually hit, where the incoming exercise is not in the
// catalogue at all and its muscles come from the model.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000405'

describe.skipIf(!canRun)('Coach swap sets the exercise role (Q-405)', () => {
  let pool: import('pg').Pool
  let db: typeof import('@/lib/data/postgres/client').getDb extends () => infer T ? T : never
  let handler: typeof import('@/lib/coach/domains/session-exercise').sessionExerciseHandler
  let programId: string, sessionId: string, targetId: string

  const roleOf = async (id: string) =>
    (await pool.query('SELECT exercise_role FROM session_exercises WHERE id=$1', [id])).rows[0]?.exercise_role

  const swapTo = (name: string, extra: { field: string; from: unknown; to: unknown }[] = []) => ([
    { field: 'exerciseName', from: 'Q405 Barbell Romanian Deadlift', to: name },
    ...extra,
  ])

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    const mod = await import('@/lib/coach/domains/session-exercise')
    pool = getPool(); db = getDb(); handler = mod.sessionExerciseHandler

    await pool.query(
      // Admin, because `createMissingExercise` is admin-gated — `exercise_library` is one shared
      // catalogue, so adding to it is a policy decision the Coach must not route around. The owner
      // is an admin, which is how they reached that path at all.
      `INSERT INTO users (id, email, password_hash, is_admin) VALUES ($1,$2,'x',true)
       ON CONFLICT (id) DO UPDATE SET is_admin = true`,
      [TEST_USER_ID, `q405-${TEST_USER_ID}@example.com`])
    // A curated catalogue entry the recommender can read: a barbell compound → primary.
    await pool.query(
      `INSERT INTO exercise_library (name, muscles, equipment) VALUES
         ('Q405 Barbell Bench Press', $1::jsonb, ARRAY['barbell']),
         ('Q405 Cable Lateral Raise', $2::jsonb, ARRAY['cable'])
       ON CONFLICT (name) DO NOTHING`,
      [JSON.stringify([{ muscle: 'chest', role: 'main' }, { muscle: 'shoulders', role: 'secondary' }, { muscle: 'triceps', role: 'secondary' }]),
       JSON.stringify([{ muscle: 'shoulders', role: 'main' }])])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM programs WHERE user_id=$1', [TEST_USER_ID])
    const p = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1,'Q405 Program') RETURNING id`, [TEST_USER_ID])
    programId = p.rows[0].id
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Q405 Session',0) RETURNING id`, [programId])
    sessionId = ps.rows[0].id
    // The outgoing exercise carries `secondary`, exactly as the owner's row did.
    const se = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, muscle_groups, exercise_role)
       VALUES ($1,'Q405 Barbell Romanian Deadlift',0,ARRAY['hamstrings','glutes'],'secondary') RETURNING id`, [sessionId])
    targetId = se.rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM programs WHERE user_id=$1', [TEST_USER_ID])
    await pool.query(`DELETE FROM session_exercises WHERE exercise_name LIKE 'Q405 %'`)
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE 'Q405 %'`)
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  it('does not inherit the outgoing role — it recommends from the catalogue', async () => {
    expect(await roleOf(targetId)).toBe('secondary')
    const changes = swapTo('Q405 Barbell Bench Press')
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    expect(res.ok).toBe(true)
    // A barbell compound is a session anchor, not the outgoing 'secondary'.
    expect(await roleOf(targetId)).toBe('primary')
  })

  it('demotes to accessory when the incoming exercise is an isolation', async () => {
    const changes = swapTo('Q405 Cable Lateral Raise')
    expect((await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)).ok).toBe(true)
    expect(await roleOf(targetId)).toBe('accessory')
  })

  it('the owner\'s case: an exercise the catalogue has never seen gets the LIGHTEST role', async () => {
    // Barbell Jefferson Curl is not in the library, so this goes through `createMissingExercise` and
    // its muscles are model-proposed. Deriving a role from those would launder model output into a
    // prescription; inheriting `secondary` is what produced 60 kg x 6 at 80%.
    const changes = swapTo('Q405 Barbell Jefferson Curl', [
      { field: 'newExerciseMuscles', from: null, to: 'lower back, hamstrings' },
    ])
    await pool.query(`DELETE FROM exercise_library WHERE name = 'Q405 Barbell Jefferson Curl'`)
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    expect(res.ok).toBe(true)
    expect(await roleOf(targetId)).toBe('accessory')
  })

  it('undo puts the original role back, not just the name', async () => {
    const changes = swapTo('Q405 Barbell Bench Press')
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    expect(await roleOf(targetId)).toBe('primary')

    await handler.undo(db, TEST_USER_ID, targetId, (res as { beforeState: Record<string, unknown> }).beforeState)
    // Restoring the name while leaving the role behind would leave the old exercise under the new
    // exercise's prescription — a different wrong answer, not a fix.
    expect(await roleOf(targetId)).toBe('secondary')
    const { rows } = await pool.query('SELECT exercise_name FROM session_exercises WHERE id=$1', [targetId])
    expect(rows[0].exercise_name).toBe('Q405 Barbell Romanian Deadlift')
  })

  it('says the role change out loud in the preview, before it is written', async () => {
    const changes = swapTo('Q405 Barbell Bench Press')
    const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes } as never)
    const roleLine = preview.consequences.find(c => /role/i.test(c.text))
    expect(roleLine, 'the preview must name the role change').toBeTruthy()
    expect(roleLine!.text).toMatch(/primary/)
    expect(roleLine!.text).toMatch(/prescribed/)
  })

  it('warns rather than informs when nothing is known about the incoming exercise', async () => {
    const changes = swapTo('Q405 Something Nobody Has Catalogued')
    const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes } as never)
    const roleLine = preview.consequences.find(c => /role/i.test(c.text))!
    expect(roleLine.kind).toBe('warn')
    expect(roleLine.text).toMatch(/lightest/)
  })
})

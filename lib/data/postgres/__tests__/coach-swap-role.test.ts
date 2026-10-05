// #2215 — a Coach swap keeps the SLOT's role. `exercise_role` selects the progression style, so the
// role decides the prescribed percentages and sets, and it belongs to the slot in the programme.
//
// The history is two defects in opposite directions. Q-405: a swap silently inherited `secondary`
// onto a Barbell Jefferson Curl and prescribed 60 kg x 6 at 80%, so the swap was made to recompute
// the role from the catalogue. Then the owner swapped Good Morning → Jefferson Curl on `Shikai /
// Lower`, a session with no Primary by design, and the recommender PROMOTED the curl to primary —
// "nobody asked for that". So the role is kept, the card says so, and Q-405's concern is a warning.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000405'

describe.skipIf(!canRun)('Coach swap keeps the slot\'s role (#2215)', () => {
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

  it('keeps the slot\'s role when a catalogued compound comes in — no Primary appears', async () => {
    expect(await roleOf(targetId)).toBe('secondary')
    const changes = swapTo('Q405 Barbell Bench Press')
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    expect(res.ok).toBe(true)
    // The recommender calls a barbell compound a primary. The slot was secondary and stays so.
    expect(await roleOf(targetId)).toBe('secondary')
    const { rows } = await pool.query('SELECT exercise_name FROM session_exercises WHERE id=$1', [targetId])
    expect(rows[0].exercise_name).toBe('Q405 Barbell Bench Press')
  })

  it('keeps the slot\'s role for an isolation too', async () => {
    const changes = swapTo('Q405 Cable Lateral Raise')
    expect((await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)).ok).toBe(true)
    expect(await roleOf(targetId)).toBe('secondary')
  })

  it('keeps the slot\'s role for an exercise the catalogue has never seen', async () => {
    const changes = swapTo('Q405 Barbell Jefferson Curl', [
      { field: 'newExerciseMuscles', from: null, to: 'lower back, hamstrings' },
    ])
    await pool.query(`DELETE FROM exercise_library WHERE name = 'Q405 Barbell Jefferson Curl'`)
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    expect(res.ok).toBe(true)
    expect(await roleOf(targetId)).toBe('secondary')
  })

  it('undo puts the name back and leaves the role where it was', async () => {
    const changes = swapTo('Q405 Barbell Bench Press')
    const res = await handler.apply(db, TEST_USER_ID, { targetId, changes } as never, changes as never)
    await handler.undo(db, TEST_USER_ID, targetId, (res as { beforeState: Record<string, unknown> }).beforeState)
    expect(await roleOf(targetId)).toBe('secondary')
    const { rows } = await pool.query('SELECT exercise_name FROM session_exercises WHERE id=$1', [targetId])
    expect(rows[0].exercise_name).toBe('Q405 Barbell Romanian Deadlift')
  })

  it('says the role is unchanged on the card, whichever exercise comes in', async () => {
    for (const name of ['Q405 Barbell Bench Press', 'Q405 Cable Lateral Raise']) {
      const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes: swapTo(name) } as never)
      const roleLine = preview.consequences.find(c => /^Role unchanged/.test(c.text))
      expect(roleLine, `the preview must name the kept role for ${name}`).toBeTruthy()
      expect(roleLine!.text).toContain('(secondary)')
      expect(preview.consequences.some(c => /Sets the role to/.test(c.text))).toBe(false)
    }
  })

  it('warns when the incoming movement looks lighter than the slot it inherits', async () => {
    const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes: swapTo('Q405 Cable Lateral Raise') } as never)
    const warn = preview.consequences.find(c => c.kind === 'warn' && /loaded as this slot/.test(c.text))
    expect(warn, 'an isolation in a secondary slot should be flagged').toBeTruthy()
    expect(warn!.text).toMatch(/an accessory/)
    expect(warn!.text).toMatch(/program editor/)
  })

  it('does not warn when the incoming movement is at least as heavy as the slot', async () => {
    const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes: swapTo('Q405 Barbell Bench Press') } as never)
    expect(preview.consequences.some(c => /loaded as this slot/.test(c.text))).toBe(false)
  })

  it('warns when nothing is known about the incoming exercise, unless the slot is already the lightest', async () => {
    const unknown = swapTo('Q405 Something Nobody Has Catalogued')
    const preview = await handler.preview(db, TEST_USER_ID, { targetId, changes: unknown } as never)
    const warn = preview.consequences.find(c => c.kind === 'warn' && /Nothing is known/.test(c.text))
    expect(warn).toBeTruthy()
    await pool.query(`UPDATE session_exercises SET exercise_role='accessory' WHERE id=$1`, [targetId])
    const accessorySlot = await handler.preview(db, TEST_USER_ID, { targetId, changes: unknown } as never)
    expect(accessorySlot.consequences.some(c => /Nothing is known/.test(c.text))).toBe(false)
  })
})

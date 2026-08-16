// The rows behind a sourced Coach picker.
//
// These exist because the model no longer writes option rows at all — it names a source and the app
// fills it. That moved the correctness of every picker from "did the model transcribe the database
// faithfully" to "does this query return the right rows", which is a thing a test can actually hold.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-00000000d001'
const STRANGER = '00000000-0000-4000-8000-00000000d002'
const OWNER_PROGRAM = '00000000-0000-4000-8000-00000000d010'
const STRANGER_PROGRAM = '00000000-0000-4000-8000-00000000d011'

describe.skipIf(!canRun)('AI Coach — sourced picker options', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let ownerSessionId = ''
  let ownerExerciseId = ''
  let strangerSessionId = ''

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const data = await import('@/lib/data')
    repo = await data.getRepository()

    for (const [id, tag] of [[OWNER, 'owner'], [STRANGER, 'stranger']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `coach-opt-${tag}@example.com`])
    }
    await pool.query(`DELETE FROM programs WHERE id = ANY($1)`, [[OWNER_PROGRAM, STRANGER_PROGRAM]])

    for (const [pid, uid, name] of [
      [OWNER_PROGRAM, OWNER, 'Owner Program'],
      [STRANGER_PROGRAM, STRANGER, 'Stranger Program'],
    ] as const) {
      await pool.query(
        `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, $3, true)`, [pid, uid, name])
      const { rows: [s] } = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, 0) RETURNING id`,
        [pid, uid === OWNER ? 'Owner Pull' : 'Stranger Pull'])
      const { rows: [e] } = await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position)
         VALUES ($1, $2, ARRAY['lats'], 0) RETURNING id`,
        [s.id, uid === OWNER ? 'Owner Row' : 'Stranger Row'])
      if (uid === OWNER) { ownerSessionId = s.id; ownerExerciseId = e.id } else { strangerSessionId = s.id }
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM programs WHERE id = ANY($1)`, [[OWNER_PROGRAM, STRANGER_PROGRAM]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  // The route's logic, exercised through the repository it uses. The HTTP layer adds auth and Zod;
  // what matters here is that the rows are the caller's own.
  async function sessionsFor(userId: string) {
    const program = await repo.getActiveProgram(userId)
    return (program?.sessions ?? []).map(s => ({ id: s.id, title: s.name }))
  }
  async function exercisesFor(userId: string, sessionId?: string) {
    const program = await repo.getActiveProgram(userId)
    const sessions = sessionId ? (program?.sessions ?? []).filter(s => s.id === sessionId) : program?.sessions ?? []
    return sessions.flatMap(s => s.exercises.map(e => ({ id: e.id, title: e.exerciseName })))
  }

  it('lists the sessions of the calling user, and only those', async () => {
    const mine = await sessionsFor(OWNER)
    expect(mine.map(s => s.title)).toContain('Owner Pull')
    expect(mine.map(s => s.title)).not.toContain('Stranger Pull')
    expect(mine.map(s => s.id)).not.toContain(strangerSessionId)
  })

  it('lists every exercise in the program when no session is named', async () => {
    const all = await exercisesFor(OWNER)
    expect(all.map(e => e.title)).toEqual(['Owner Row'])
  })

  it('narrows to one session when a session id is given', async () => {
    expect((await exercisesFor(OWNER, ownerSessionId)).map(e => e.id)).toEqual([ownerExerciseId])
  })

  it("returns nothing for another user's session id rather than their exercises", async () => {
    // Ownership comes from the session, never from the id in the request — a client asking for a
    // stranger's session gets an empty list, not their program.
    expect(await exercisesFor(OWNER, strangerSessionId)).toEqual([])
  })
})

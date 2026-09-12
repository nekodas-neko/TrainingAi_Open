// BF-144 — "has THIS program session been trained since its phase clock started?"
//
// BF-143 answered it by asking whether the session's exercise NAMES had ever been logged. That is
// right only while names stay unique and unchanged; the id link (`workout_sessions.session_id`,
// Drizzle property `programSessionId`) was populated the whole time and answers directly. The
// reason BF-143 gave for reaching for names — "the id is NULL on every row" — measured the DEAD
// column of the pair `schema.ts` warns about.
//
// The route can only assert that it asks with the right id and the right clock. The comparison
// itself — the join, the date boundary, the user scoping and the two soft-delete filters — lives
// here, against a real database.
//
// No timezone appears in this query: `since` arrives as a timestamp and is compared as one, so both
// sides of every fixture are derived from the same clock and the file has no hour-dependence.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e0b1'
const OTHER = '00000000-0000-4000-8000-00000000e0b2'

describe.skipIf(!canRun)('wasProgramSessionTrainedSince', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/periodization')
  let programId = ''
  let sessionA = ''
  let sessionB = ''

  const phaseStart = () => new Date(Date.now() - 7 * 86_400_000)

  /** A completed workout of `programSession`, with one exercise log at `offsetMs` from now. */
  const train = async (
    user: string, programSession: string | null, name: string, offsetMs: number,
  ): Promise<{ workoutSessionId: string; exerciseLogId: string }> => {
    const at = new Date(Date.now() + offsetMs)
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, $3, $4) RETURNING id`, [user, programSession, name, at])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, logged_at)
       VALUES ($1, 'Squat', 100, 120, $2) RETURNING id`, [ws.id, at])
    return { workoutSessionId: ws.id, exerciseLogId: el.id }
  }

  const ask = (programSession = sessionA, user = USER) =>
    slice.wasProgramSessionTrainedSince(db, user, programSession, phaseStart())

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/periodization')
    for (const [id, email] of [[USER, 'bf144-a@example.com'], [OTHER, 'bf144-b@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [id, email])
    }
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1, 'BF-144 Program') RETURNING id`, [USER])
    programId = p.id
    // Two sessions SHARING A NAME — the case a name lookup cannot tell apart, and the reason
    // BF-144 exists rather than only tidying BF-143's comment.
    const { rows } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position)
       VALUES ($1, 'Lower', 0), ($1, 'Lower', 1) RETURNING id`, [programId])
    sessionA = rows[0].id; sessionB = rows[1].id
  })

  afterAll(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
    }
  })

  it('says no when nothing has been logged at all', async () => {
    expect(await ask()).toBe(false)
  })

  it('says yes for a log inside the phase', async () => {
    await train(USER, sessionA, 'Lower', -86_400_000)
    expect(await ask()).toBe(true)
  })

  it('says no for a log that predates the phase clock — the recreated session', async () => {
    await train(USER, sessionA, 'Lower', -30 * 86_400_000)
    expect(await ask()).toBe(false)
  })

  // The whole of BF-144 in one case: same name, different session. A name lookup answers yes.
  it('does not answer about a DIFFERENT session that happens to share the name', async () => {
    await train(USER, sessionB, 'Lower', -86_400_000)
    expect(await ask(sessionA)).toBe(false)
    expect(await ask(sessionB)).toBe(true)
  })

  // The 46 rows predating the link. They cannot speak for themselves, and must not be guessed at.
  it('ignores a workout with no id link, however recent', async () => {
    await train(USER, null, 'Lower', -3_600_000)
    expect(await ask()).toBe(false)
  })

  it('does not let another user\'s workout answer', async () => {
    await train(OTHER, sessionA, 'Lower', -86_400_000)
    expect(await ask()).toBe(false)
  })

  it('ignores a soft-deleted workout session', async () => {
    const { workoutSessionId } = await train(USER, sessionA, 'Lower', -86_400_000)
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [workoutSessionId])
    expect(await ask()).toBe(false)
  })

  it('ignores a soft-deleted exercise log', async () => {
    const { exerciseLogId } = await train(USER, sessionA, 'Lower', -86_400_000)
    await pool.query(`UPDATE exercise_logs SET deleted_at = now() WHERE id = $1`, [exerciseLogId])
    expect(await ask()).toBe(false)
  })

  // A workout row with no exercise log is a session that was opened and not trained.
  it('ignores a workout session carrying no exercise log', async () => {
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'Lower', now())`, [USER, sessionA])
    expect(await ask()).toBe(false)
  })

  // `gte`, not `gt`: a log at the exact instant the phase started is training within it.
  it('counts a log landing exactly on the phase clock', async () => {
    const since = phaseStart()
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'Lower', $3) RETURNING id`, [USER, sessionA, since])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, logged_at)
       VALUES ($1, 'Squat', 100, 120, $2)`, [ws.id, since])
    expect(await slice.wasProgramSessionTrainedSince(db, USER, sessionA, since)).toBe(true)
  })
})

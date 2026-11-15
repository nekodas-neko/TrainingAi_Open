// RV-32, third site: `exercise_logs.style_id` is a client-supplied FK into a strictly user-scoped
// table, and it arrived unchecked on BOTH the web route and the outbox's `pushMutations` branch.
// The guard lives in `logExerciseFromPayload`, which is the one function both call.
//
// **Why this site drops the id rather than refusing the request.** A 4xx on a queued mutation is a
// poison pill the outbox quarantines, so refusing would cost the user a whole logged workout over a
// metadata column. The two program-config paths refuse instead, because there the user is editing
// interactively and can see the rejection.
//
// Drives the real function against a local dev Postgres. Skips cleanly where there is no
// DATABASE_URL (CI's "Tests" job) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-0000000fc0b1'
const STRANGER = '00000000-0000-4000-8000-0000000fc0b2'

describe.skipIf(!canRun)('exercise_logs.style_id ownership (RV-32)', () => {
  let pool: import('pg').Pool
  let logExerciseFromPayload: typeof import('@trainingai/shared/workout/log-exercise').logExerciseFromPayload
  let ownStyleId: string
  let foreignStyleId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise'))
    pool = getPool()
    for (const [id, tag] of [[OWNER, 'owner'], [STRANGER, 'stranger']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `log-style-${tag}@example.com`],
      )
    }
    const own = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Owner Ramp') RETURNING id`, [OWNER])
    ownStyleId = own.rows[0].id
    const foreign = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Stranger Ramp') RETURNING id`, [STRANGER])
    foreignStyleId = foreign.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [OWNER, STRANGER]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  async function styleIdFor(exercise: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT el.style_id FROM exercise_logs el
         JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = $2`,
      [OWNER, exercise],
    )
    return rows[0]?.style_id ?? null
  }

  const payload = (exercise: string, styleId: string) => ({
    sessionName: 'Style Ownership', exercise, weights: [100], sets: 1, reps: [5], styleId,
  })

  it('keeps a style id the logger owns', async () => {
    await logExerciseFromPayload(OWNER, payload('Own Style Bench', ownStyleId) as never, 'Australia/Brisbane')
    expect(await styleIdFor('Own Style Bench')).toBe(ownStyleId)
  })

  it("drops a style id belonging to someone else, and still logs the set", async () => {
    await logExerciseFromPayload(OWNER, payload('Foreign Style Bench', foreignStyleId) as never, 'Australia/Brisbane')
    expect(await styleIdFor('Foreign Style Bench')).toBeNull()

    // The whole point of dropping rather than refusing: the training data survives.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM set_logs sl
         JOIN exercise_logs el ON el.id = sl.exercise_log_id
         JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = 'Foreign Style Bench'`, [OWNER])
    expect(rows[0].n).toBe(1)
  })

  it('drops a malformed style id rather than 22P02-ing at the driver', async () => {
    await expect(
      logExerciseFromPayload(OWNER, payload('Malformed Style Bench', 'not-a-uuid') as never, 'Australia/Brisbane'),
    ).resolves.toBeTruthy()
    expect(await styleIdFor('Malformed Style Bench')).toBeNull()
  })

  // #3796: the payload's `sessionId` becomes the workout's program session link (the `session_id`
  // column, `programSessionId` in the schema). Dropped to null,
  // like the style id, when it is not a session of one of the logger's own programs.
  describe('program session link', () => {
    let ownSessionId: string
    let foreignSessionId: string

    beforeAll(async () => {
      const session = async (userId: string, name: string) => {
        const { rows: [prog] } = await pool.query(
          `INSERT INTO programs (user_id, name, is_active) VALUES ($1, $2, false) RETURNING id`, [userId, `${name} Program`])
        return (await pool.query(
          `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, 0) RETURNING id`, [prog.id, name])).rows[0].id as string
      }
      ownSessionId = await session(OWNER, 'Owner Day')
      foreignSessionId = await session(STRANGER, 'Stranger Day')
    })

    const linkFor = async (sessionName: string) => (await pool.query(
      `SELECT session_id FROM workout_sessions WHERE user_id = $1 AND session_name = $2`,
      [OWNER, sessionName])).rows[0]?.session_id ?? null

    const logIn = (sessionName: string, sessionId: string) => logExerciseFromPayload(OWNER, {
      sessionName, sessionId, exercise: `${sessionName} Bench`, weights: [100], sets: 1, reps: [5],
    } as never, 'Australia/Brisbane')

    it('keeps a session of the logger\'s own program', async () => {
      await logIn('Own Link Session', ownSessionId)
      expect(await linkFor('Own Link Session')).toBe(ownSessionId)
    })

    it("drops another user's session, and still logs the set", async () => {
      await logIn('Foreign Link Session', foreignSessionId)
      expect(await linkFor('Foreign Link Session')).toBeNull()
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM exercise_logs el
           JOIN workout_sessions ws ON ws.id = el.workout_session_id
          WHERE ws.user_id = $1 AND ws.session_name = 'Foreign Link Session'`, [OWNER])
      expect(rows[0].n).toBe(1)
    })

    it("names a calendar day from the stored name when the link is not the caller's", async () => {
      // A link stored before the check existed: the calendar must not read the other session's name.
      const { rows: [ws] } = await pool.query(
        `SELECT id, started_at FROM workout_sessions WHERE user_id = $1 AND session_name = 'Own Link Session'`, [OWNER])
      await pool.query(`UPDATE workout_sessions SET session_id = $1 WHERE id = $2`, [foreignSessionId, ws.id])
      const { getRepositoryAsync } = await import('@/lib/data')
      const repo = await getRepositoryAsync()
      const started = new Date(ws.started_at)
      const local = new Date(started.toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }))
      const cal = await repo.getCalendarData(OWNER, local.getFullYear(), local.getMonth() + 1, 'Australia/Brisbane')
      const names = Object.values(cal.trainedDays).flat()
      expect(names).toContain('Own Link Session')
      expect(names).not.toContain('Stranger Day')
      await pool.query(`UPDATE workout_sessions SET session_id = $1 WHERE id = $2`, [ownSessionId, ws.id])
      const renamed = Object.values((await repo.getCalendarData(OWNER, local.getFullYear(), local.getMonth() + 1, 'Australia/Brisbane')).trainedDays).flat()
      expect(renamed).toContain('Owner Day')
    })
  })
})

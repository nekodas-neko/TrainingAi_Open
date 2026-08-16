// The seventeen soft-delete filters in the periodization slice (Q-182).
//
// This slice is what the AI prescription reads from: how many sessions a phase has seen, what was
// lifted recently, how long sets take, the 1RM trend, and weekly set volume per muscle. Every one
// of those is an aggregate, so a broken filter does not lose data — it silently inflates a number
// the next prescription is built on. Until now, removing any of these seventeen `deleted_at`
// filters failed no test at all.
//
// Each case deletes at exactly ONE level (set / exercise log / session), so a filter that stops
// working is attributable rather than merely detectable. Every filter was verified by mutation:
// rewriting it to `1 = 1` (raw SQL) or dropping the `isNull(...)` (drizzle) fails the case named
// for it, and nothing else.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e002'
const TZ = 'Australia/Brisbane'

// One name the exercise library knows (drives the jsonb-muscles branch of the weekly-sets query)
// and one it does not (drives the el.muscle_groups branch). Both branches carry their own three
// filters, so a fixture covering only one would leave three of the seventeen untested.
const LIB_EXERCISE = 'Decline Crunch'
const FREE_EXERCISE = 'SD Unlisted Lift'

describe.skipIf(!canRun)('periodization slice — soft-delete filters', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/periodization')
  let programId = ''
  let programSessionId = ''
  let sessionId = ''
  let libLogId = ''
  let freeLogId = ''
  let setIds: string[] = []
  let weekStart = ''
  let weekEnd = ''

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/periodization')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'periodization-sd@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1, 'SD Periodization') RETURNING id`, [USER])
    programId = p.id
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'SD Session', 0) RETURNING id`, [programId])
    programSessionId = ps.id
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM session_periodization WHERE user_id = $1`, [USER])

    // Started an hour ago so the session sits inside today's user-local week regardless of the
    // hour the suite runs at — the weekly window below is derived from the same clock.
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'SD Session', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
      [USER, programSessionId])
    sessionId = ws.id

    const { rows: [lib] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, logged_at)
       VALUES ($1, $2, 100, 120, now()) RETURNING id`, [sessionId, LIB_EXERCISE])
    libLogId = lib.id
    const { rows: [free] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, muscle_groups, logged_at)
       VALUES ($1, $2, 100, 90, ARRAY['Hamstrings'], now()) RETURNING id`, [sessionId, FREE_EXERCISE])
    freeLogId = free.id

    const { rows } = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec) VALUES
         ($1, 1, 50, 5, 30), ($2, 1, 50, 5, 30) RETURNING id`, [libLogId, freeLogId])
    setIds = rows.map(r => r.id)

    const { rows: [d] } = await pool.query(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`, [TZ])
    weekStart = d.today; weekEnd = d.today

    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase)
       VALUES ($1, $2, 'accumulation', now() - interval '30 days', 0)
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET sessions_in_phase = 0`,
      [USER, programSessionId])
  })

  const del = {
    set: (id: string) => pool.query(`UPDATE set_logs SET deleted_at = now() WHERE id = $1`, [id]),
    log: (id: string) => pool.query(`UPDATE exercise_logs SET deleted_at = now() WHERE id = $1`, [id]),
    session: () => pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [sessionId]),
  }

  // ── reconcileSessionsInPhase — ws.deleted_at, and the EXISTS on el.deleted_at ──
  // The counter this heals gates phase advancement, so an uncorrected delete advances a block early.
  describe('reconcileSessionsInPhase', () => {
    async function counted() {
      await slice.reconcileSessionsInPhase(db, USER, programId)
      const { rows } = await pool.query(
        `SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1`, [USER])
      return Number(rows[0]?.sessions_in_phase ?? -1)
    }

    it('counts a live completed session', async () => {
      expect(await counted()).toBe(1)
    })

    it('stops counting a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(await counted()).toBe(0)
    })

    it('stops counting a session whose every EXERCISE LOG is deleted (el.deleted_at)', async () => {
      // The session row itself is untouched — only the EXISTS clause can notice this.
      await del.log(libLogId); await del.log(freeLogId)
      expect(await counted()).toBe(0)
    })
  })

  // ── getWorkoutSessionProgramSessionId — ws.deleted_at ──
  describe('getWorkoutSessionProgramSessionId', () => {
    it('resolves a live session, and nothing for a deleted one (ws.deleted_at)', async () => {
      expect(await slice.getWorkoutSessionProgramSessionId(db, USER, sessionId)).toBe(programSessionId)
      await del.session()
      expect(await slice.getWorkoutSessionProgramSessionId(db, USER, sessionId)).toBeNull()
    })
  })

  // ── getRecentSessionsOfType — ws.deleted_at ──
  describe('getRecentSessionsOfType', () => {
    it('omits a deleted session from the recent list (ws.deleted_at)', async () => {
      expect(await slice.getRecentSessionsOfType(db, USER, programSessionId, 10)).toHaveLength(1)
      await del.session()
      expect(await slice.getRecentSessionsOfType(db, USER, programSessionId, 10)).toHaveLength(0)
    })
  })

  // ── getSetLogsForSessions — sl.deleted_at, el.deleted_at ──
  describe('getSetLogsForSessions', () => {
    const rows = () => slice.getSetLogsForSessions(db, [sessionId])

    it('returns one row per live set', async () => {
      expect(await rows()).toHaveLength(2)
    })

    it('drops a deleted SET only (sl.deleted_at)', async () => {
      await del.set(setIds[0])
      const out = await rows()
      expect(out).toHaveLength(1)
      expect(out[0].exerciseName).toBe(FREE_EXERCISE)
    })

    it('drops the sets under a deleted EXERCISE LOG (el.deleted_at)', async () => {
      await del.log(libLogId)
      const out = await rows()
      expect(out).toHaveLength(1)
      expect(out[0].exerciseName).toBe(FREE_EXERCISE)
    })
  })

  // ── getSetTimingRows — sl.deleted_at, el.deleted_at, ws.deleted_at ──
  // Feeds the measured set/rest durations the time-budget trimmer plans against.
  describe('getSetTimingRows', () => {
    const rows = () => slice.getSetTimingRows(db, USER, [LIB_EXERCISE, FREE_EXERCISE])

    it('returns a row per live set', async () => {
      expect(await rows()).toHaveLength(2)
    })

    it('drops a deleted SET only (sl.deleted_at)', async () => {
      await del.set(setIds[0])
      expect(await rows()).toHaveLength(1)
    })

    it('drops a deleted EXERCISE LOG only (el.deleted_at)', async () => {
      await del.log(libLogId)
      expect(await rows()).toHaveLength(1)
    })

    it('drops everything under a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(await rows()).toHaveLength(0)
    })
  })

  // ── getExercise1rmHistory — el.deleted_at, ws.deleted_at ──
  describe('getExercise1rmHistory', () => {
    const hist = () => slice.getExercise1rmHistory(db, USER, [LIB_EXERCISE, FREE_EXERCISE], TZ)

    it('reports a point per exercise from live logs', async () => {
      const h = await hist()
      expect(h[LIB_EXERCISE]?.[0]?.rm).toBe(120)
      expect(h[FREE_EXERCISE]?.[0]?.rm).toBe(90)
    })

    it('drops a deleted EXERCISE LOG only (el.deleted_at)', async () => {
      await del.log(libLogId)
      const h = await hist()
      expect(h[LIB_EXERCISE]).toBeUndefined()
      expect(h[FREE_EXERCISE]?.[0]?.rm).toBe(90)
    })

    it('drops both under a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(await hist()).toEqual({})
    })
  })

  // ── getWeeklySetsByMuscleGroup — sl/el/ws deleted_at, TWICE (library and non-library branches) ──
  // Overstated weekly sets are what the AI reads as "already at volume target", so it prescribes
  // less; a stale set here quietly suppresses volume.
  describe('getWeeklySetsByMuscleGroup', () => {
    const sets = () => slice.getWeeklySetsByMuscleGroup(db, USER, programId, weekStart, weekEnd, TZ)

    it('counts both branches — the library exercise by role, the unlisted one by its own muscles', async () => {
      const out = await sets()
      expect(out.abs).toBe(1)           // library: single "main" muscle → weight 1.0,
                                        // keyed by normalizeMuscle, which folds "core" → "abs"
      expect(out.hamstrings).toBe(1)    // non-library: el.muscle_groups
    })

    // Each branch is a separate query with its own three filters, so every case below is run from
    // BOTH sides. Deleting only one side leaves the other branch's filter untested — the mutation
    // sweep caught exactly that: the library `el` filter and the non-library `sl` filter both
    // survived until these were split in two.
    it('drops a deleted SET in the LIBRARY branch (sl.deleted_at, library query)', async () => {
      await del.set(setIds[0])
      const out = await sets()
      expect(out.abs).toBeUndefined()
      expect(out.hamstrings).toBe(1)
    })

    it('drops a deleted SET in the NON-LIBRARY branch (sl.deleted_at, non-library query)', async () => {
      await del.set(setIds[1])
      const out = await sets()
      expect(out.abs).toBe(1)
      expect(out.hamstrings).toBeUndefined()
    })

    it('drops a deleted EXERCISE LOG in the LIBRARY branch (el.deleted_at, library query)', async () => {
      await del.log(libLogId)
      const out = await sets()
      expect(out.abs).toBeUndefined()
      expect(out.hamstrings).toBe(1)
    })

    it('drops a deleted EXERCISE LOG in the NON-LIBRARY branch (el.deleted_at, non-library query)', async () => {
      await del.log(freeLogId)
      const out = await sets()
      expect(out.abs).toBe(1)
      expect(out.hamstrings).toBeUndefined()
    })

    it('empties both branches under a deleted SESSION (ws.deleted_at ×2)', async () => {
      await del.session()
      expect(await sets()).toEqual({})
    })
  })
})

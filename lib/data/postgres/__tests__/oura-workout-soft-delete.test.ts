// The eleven soft-delete filters in the oura slice's workout queries (Q-182, the last of the 35).
//
// These are the HR-attribution work lists: which finished sessions still need heart-rate stats
// computed, and which sets those stats attach to. A broken filter here does not lose data — it
// hands a deleted session or set to the HR pipeline, which then writes stats for a workout the user
// removed and keeps re-selecting it every run because the stats never "complete".
//
// Each case deletes at exactly ONE level (set / exercise log / session), so a filter that stops
// working is attributable rather than merely detectable. All eleven verified by mutation: replacing
// each `isNull(...deletedAt)` with an always-true predicate on the same table fails the case named
// for it, and nothing else.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e003'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('oura slice, workout queries — soft-delete filters', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/oura')
  let sessionId = ''
  let logId = ''
  let setIds: string[] = []
  let localDay = ''
  let since: Date

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'oura-workout-sd@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])

    // Everything derives from the clock — never a fixed date. A window fixture pinned to a literal
    // timestamp passes until the day it silently falls outside the window (the rule in CLAUDE.md's
    // Date Arithmetic section, learned from scale-ble-day-keying).
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'SD HR', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`, [USER])
    sessionId = ws.id
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'SD Bench', 100, now()) RETURNING id`, [sessionId])
    logId = el.id
    const { rows } = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_start_ms, set_end_ms)
       VALUES ($1, 1, 50, 5, 1000, 2000), ($1, 2, 50, 5, 3000, 4000) RETURNING id`, [logId])
    setIds = rows.map(r => r.id)

    // The user-local day the session actually falls on, read back from the row itself.
    const { rows: [d] } = await pool.query(
      `SELECT to_char((started_at AT TIME ZONE $2), 'YYYY-MM-DD') AS day FROM workout_sessions WHERE id = $1`,
      [sessionId, TZ])
    localDay = d.day
    since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  })

  const del = {
    set: (id: string) => pool.query(`UPDATE set_logs SET deleted_at = now() WHERE id = $1`, [id]),
    log: () => pool.query(`UPDATE exercise_logs SET deleted_at = now() WHERE id = $1`, [logId]),
    session: () => pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [sessionId]),
  }
  const ids = (rows: { id: string }[]) => rows.map(r => r.id)

  // ── listSessionsMissingHrStats — ws.deleted_at ──
  describe('listSessionsMissingHrStats', () => {
    const list = () => slice.listSessionsMissingHrStats(db, USER, since, 50)

    it('offers a finished session with no HR stats yet', async () => {
      expect(ids(await list())).toContain(sessionId)
    })

    it('stops offering a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(ids(await list())).not.toContain(sessionId)
    })
  })

  // ── getSetDetailsForSession — sl.deleted_at, el.deleted_at ──
  describe('getSetDetailsForSession', () => {
    const rows = () => slice.getSetDetailsForSession(db, sessionId)

    it('returns a marker per live set', async () => {
      expect(await rows()).toHaveLength(2)
    })

    it('drops a deleted SET only (sl.deleted_at)', async () => {
      await del.set(setIds[0])
      expect(await rows()).toHaveLength(1)
    })

    it('drops every set under a deleted EXERCISE LOG (el.deleted_at)', async () => {
      await del.log()
      expect(await rows()).toHaveLength(0)
    })
  })

  // ── listSessionsMissingSetHrStats — el, sl and ws deleted_at ──
  // This one INNER-joins through the logs, so each level removes the session from the work list for
  // a different reason.
  describe('listSessionsMissingSetHrStats', () => {
    const list = () => slice.listSessionsMissingSetHrStats(db, USER, since, 50)

    it('offers a session whose sets have no HR stats yet', async () => {
      expect(ids(await list())).toContain(sessionId)
    })

    it('still offers it when only ONE of its sets is deleted', async () => {
      // The join survives on the remaining live set — deleting one set must not strand the session.
      await del.set(setIds[0])
      expect(ids(await list())).toContain(sessionId)
    })

    it('stops offering it once EVERY set is deleted (sl.deleted_at)', async () => {
      await del.set(setIds[0]); await del.set(setIds[1])
      expect(ids(await list())).not.toContain(sessionId)
    })

    it('stops offering it when the EXERCISE LOG is deleted (el.deleted_at)', async () => {
      await del.log()
      expect(ids(await list())).not.toContain(sessionId)
    })

    it('stops offering a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(ids(await list())).not.toContain(sessionId)
    })
  })

  // ── getSetTimestampsForSession — sl.deleted_at, el.deleted_at ──
  // These timestamps are the windows HR readings get attributed to; a deleted set's window would
  // claim readings that belong to the set the user kept.
  describe('getSetTimestampsForSession', () => {
    const rows = () => slice.getSetTimestampsForSession(db, sessionId)

    it('returns a window per live set', async () => {
      expect(await rows()).toHaveLength(2)
    })

    it('drops a deleted SET only (sl.deleted_at)', async () => {
      await del.set(setIds[1])
      const out = await rows()
      expect(out).toHaveLength(1)
      expect(out[0].setNumber).toBe(1)
    })

    it('drops every window under a deleted EXERCISE LOG (el.deleted_at)', async () => {
      await del.log()
      expect(await rows()).toHaveLength(0)
    })
  })

  // ── getUnsyncedHrSessionsForDay — ws.deleted_at ──
  describe('getUnsyncedHrSessionsForDay', () => {
    const list = () => slice.getUnsyncedHrSessionsForDay(db, USER, localDay)

    it('finds the day\'s session while its HR is unsynced', async () => {
      expect(ids(await list())).toContain(sessionId)
    })

    it('skips a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(ids(await list())).not.toContain(sessionId)
    })
  })

  // ── getUnsyncedHrSessions — ws.deleted_at ──
  describe('getUnsyncedHrSessions', () => {
    const list = () => slice.getUnsyncedHrSessions(db, USER, since, new Date(Date.now() + 60_000))

    it('finds the session in the window while its HR is unsynced', async () => {
      expect(ids(await list())).toContain(sessionId)
    })

    it('skips a deleted SESSION (ws.deleted_at)', async () => {
      await del.session()
      expect(ids(await list())).not.toContain(sessionId)
    })
  })

  // ── getWorkoutSessionById — ws.deleted_at ──
  describe('getWorkoutSessionById', () => {
    it('resolves a live session and nothing for a deleted one (ws.deleted_at)', async () => {
      expect((await slice.getWorkoutSessionById(db, USER, sessionId))?.id).toBe(sessionId)
      await del.session()
      expect(await slice.getWorkoutSessionById(db, USER, sessionId)).toBeNull()
    })
  })
})

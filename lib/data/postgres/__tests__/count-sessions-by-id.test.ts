// WK-15: countAllSessionsSinceStart keys phase progress by program-session id, not
// session name — so renaming a session no longer resets its phase progress
// (session identity = DB id). Runs only against a real local dev Postgres; skips
// cleanly in CI (no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000001500'

describe.skipIf(!canRun)('countAllSessionsSinceStart keys by program-session id (WK-15)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let countAllSessionsSinceStart: typeof import('@/lib/data/postgres/slices/programs').countAllSessionsSinceStart
  let programId: string
  let sessionId: string

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    ;({ countAllSessionsSinceStart } = await import('@/lib/data/postgres/slices/programs'))
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `wk15-test-${TEST_USER_ID}@example.com`],
    )
    const prog = await pool.query(
      // cycle_anchor_at / started_at left NULL so the "since start" filter admits every row.
      `INSERT INTO programs (user_id, name, phase_mode) VALUES ($1, 'WK-15 Test', 'automatic') RETURNING id`,
      [TEST_USER_ID],
    )
    programId = prog.rows[0].id
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Push', 0) RETURNING id`,
      [programId],
    )
    sessionId = ps.rows[0].id
  })

  afterEach(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    // reset the canonical name between cases
    await pool.query(`UPDATE program_sessions SET name = 'Push' WHERE id = $1`, [sessionId])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE id = $1`, [programId])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const insertSession = (opts: { sessionId: string | null; name: string; earlyDeload?: boolean; deleted?: boolean }) =>
    pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, is_early_deload, deleted_at)
       VALUES ($1, $2, $3, now(), $4, $5)`,
      [TEST_USER_ID, opts.sessionId, opts.name, opts.earlyDeload ?? false, opts.deleted ? new Date() : null],
    )

  it('counts id-populated rows under the program-session id', async () => {
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId, name: 'Push' })

    const counts = await countAllSessionsSinceStart(db, TEST_USER_ID, programId)
    expect(counts.get(sessionId)).toBe(3)
    // never keyed by name
    expect(counts.get('push')).toBeUndefined()
  })

  it('a rename does NOT reset the count — id rows still count under the id (the WK-15 fix)', async () => {
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId, name: 'Push' })

    // Rename the program session; the historical rows keep their old session_name.
    await pool.query(`UPDATE program_sessions SET name = 'Chest Day' WHERE id = $1`, [sessionId])

    const counts = await countAllSessionsSinceStart(db, TEST_USER_ID, programId)
    expect(counts.get(sessionId)).toBe(2)
    // The old name-keyed behaviour (the bug) would have returned 0 here.
  })

  it('resolves legacy null-session_id rows by name within the program', async () => {
    // Two id-populated rows + two legacy rows (null session_id) whose name matches the
    // current program session — all four must roll up under the same id.
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId: null, name: 'Push' })
    await insertSession({ sessionId: null, name: 'push' }) // case-insensitive match

    const counts = await countAllSessionsSinceStart(db, TEST_USER_ID, programId)
    expect(counts.get(sessionId)).toBe(4)
  })

  it('omits null-session_id rows that match no current session, and excludes deleted / early-deload rows', async () => {
    await insertSession({ sessionId, name: 'Push' })
    await insertSession({ sessionId: null, name: 'A Session Since Deleted' }) // omitted (no id, no name match)
    await insertSession({ sessionId, name: 'Push', deleted: true })          // excluded (tombstoned)
    await insertSession({ sessionId, name: 'Push', earlyDeload: true })      // excluded (early deload)

    const counts = await countAllSessionsSinceStart(db, TEST_USER_ID, programId)
    expect(counts.get(sessionId)).toBe(1)
    expect(counts.size).toBe(1) // the unmatched null-id row produced no entry
  })
})

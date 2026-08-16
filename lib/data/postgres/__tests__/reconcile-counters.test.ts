// Integration suite: SYNC-T1 (user_stats reconcile-on-read) and SYNC-T2
// (sessions_in_phase reconcile at the prescribe route). Runs only against a
// real Postgres — skips cleanly without DATABASE_URL. NOTE: CI's "Tests" job DOES
// set DATABASE_URL, so these run there; to reproduce CI locally you must set it too,
// otherwise vitest silently skips ~49 tests and a green local run means little.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-00000000c0de'

describe.skipIf(!canRun)('reconcileUserStats (SYNC-T1)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let reconcileUserStats: typeof import('@/lib/data/postgres/slices/user-stats').reconcileUserStats

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    ;({ reconcileUserStats } = await import('@/lib/data/postgres/slices/user-stats'))
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `reconcile-test-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('derives totals from source-of-truth rows and self-heals a directly-inflated counter', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Reconcile Test', now(), now()) RETURNING id`,
      [TEST_USER_ID],
    )
    const workoutSessionId = ws.rows[0].id
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at) VALUES ($1, 'Bench Press', 500, now()) RETURNING id`,
      [workoutSessionId],
    )
    const exerciseLogId = el.rows[0].id
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 100, 5), ($1, 2, 100, 5)`,
      [exerciseLogId],
    )

    // Simulate a direct-DB-edit inflation (the exact bug class this fixes).
    await pool.query(
      `INSERT INTO user_stats (user_id, total_sessions, total_volume_kg, total_sets, updated_at)
       VALUES ($1, 999, 99999, 999, now())
       ON CONFLICT (user_id) DO UPDATE SET total_sessions = 999, total_volume_kg = 99999, total_sets = 999`,
      [TEST_USER_ID],
    )

    await reconcileUserStats(db, TEST_USER_ID)

    const row = await pool.query(
      `SELECT total_sessions, total_volume_kg, total_sets FROM user_stats WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(row.rows[0].total_sessions).toBe(1)
    expect(Number(row.rows[0].total_volume_kg)).toBe(500)
    expect(row.rows[0].total_sets).toBe(2)

    await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [workoutSessionId])
  })

  it('zeroes out when every session is deleted (never just no-ops on an inflated row)', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, deleted_at) VALUES ($1, 'Deleted Test', now(), now()) RETURNING id`,
      [TEST_USER_ID],
    )
    await pool.query(
      `INSERT INTO user_stats (user_id, total_sessions, total_volume_kg, total_sets, updated_at)
       VALUES ($1, 5, 500, 20, now())
       ON CONFLICT (user_id) DO UPDATE SET total_sessions = 5, total_volume_kg = 500, total_sets = 20`,
      [TEST_USER_ID],
    )

    await reconcileUserStats(db, TEST_USER_ID)

    const row = await pool.query(`SELECT total_sessions, total_volume_kg, total_sets FROM user_stats WHERE user_id = $1`, [TEST_USER_ID])
    expect(row.rows[0].total_sessions).toBe(0)
    expect(Number(row.rows[0].total_volume_kg)).toBe(0)
    expect(row.rows[0].total_sets).toBe(0)

    await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [ws.rows[0].id])
  })
})

describe.skipIf(!canRun)('sessions_in_phase reconcile at prescribe route (SYNC-T2)', () => {
  it('the prescribe path reconciles before reading the phase-ceiling guard', async () => {
    const read = (rel: string) =>
      import('fs/promises').then(fs => fs.readFile(new URL(rel, import.meta.url), 'utf-8'))
    // The generation core (incl. the sessions_in_phase self-heal) was extracted from the route
    // into lib/ai-periodization/generate-prescription.ts, which the route delegates to and which
    // the workout-completion path also calls in-process. Assert the reconcile lives there and the
    // route still routes through it, so the SYNC-T2 guarantee holds on the prescribe path.
    const gen = await read('../../../../packages/shared/src/ai-periodization/generate-prescription.ts')
    expect(gen).toMatch(/reconcileSessionsInPhase/)
    const route = await read('../../../../app/api/ai-periodization/session/[sessionId]/prescribe/route.ts')
    expect(route).toMatch(/generatePrescriptionForSession/)
  })
})

// AI-5: canonical definition of "a session in the current phase" is completed
// (completed_at IS NOT NULL), non-deleted, since phase_started_at.
describe.skipIf(!canRun)('reconcileSessionsInPhase canonical definition (AI-5)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let reconcileSessionsInPhase: typeof import('@/lib/data/postgres/slices/periodization').reconcileSessionsInPhase
  let programId: string
  let programSessionId: string

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    ;({ reconcileSessionsInPhase } = await import('@/lib/data/postgres/slices/periodization'))
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `reconcile-test-${TEST_USER_ID}@example.com`],
    )
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode) VALUES ($1, 'Reconcile AI-5 Test', 'ai_dynamic') RETURNING id`,
      [TEST_USER_ID],
    )
    programId = prog.rows[0].id
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Test Session', 0) RETURNING id`,
      [programId],
    )
    programSessionId = ps.rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase_started_at, sessions_in_phase)
       VALUES ($1, $2, now() - interval '7 days', 0)`,
      [TEST_USER_ID, programSessionId],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE id = $1`, [programId])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('an abandoned (started, never completed) session neither counts on reconcile nor decrements on delete', async () => {
    const { deleteWorkoutSession } = await import('@/lib/workout/delete-session')

    const abandoned = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'Test Session', now()) RETURNING id`,
      [TEST_USER_ID, programSessionId],
    )
    const abandonedId = abandoned.rows[0].id
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at) VALUES ($1, 'Bench Press', 100, now()) RETURNING id`,
      [abandonedId],
    )
    await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 100, 5)`, [el.rows[0].id])

    await reconcileSessionsInPhase(db, TEST_USER_ID, programId)
    let row = await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])
    expect(row.rows[0].sessions_in_phase).toBe(0)

    // Manually inflate to simulate an earlier miscount, then confirm delete doesn't
    // "helpfully" decrement it for a session that was never counted in the first place.
    await pool.query(`UPDATE session_periodization SET sessions_in_phase = 3 WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])
    await deleteWorkoutSession(TEST_USER_ID, abandonedId)
    row = await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])
    expect(row.rows[0].sessions_in_phase).toBe(3)
  })

  it('a completed session counts on reconcile and decrements correctly on delete', async () => {
    const { deleteWorkoutSession } = await import('@/lib/workout/delete-session')

    await pool.query(`UPDATE session_periodization SET sessions_in_phase = 0 WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])

    const completed = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Test Session', now(), now()) RETURNING id`,
      [TEST_USER_ID, programSessionId],
    )
    const completedId = completed.rows[0].id
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at) VALUES ($1, 'Squat', 100, now()) RETURNING id`,
      [completedId],
    )
    await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 100, 5)`, [el.rows[0].id])

    await reconcileSessionsInPhase(db, TEST_USER_ID, programId)
    let row = await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])
    expect(row.rows[0].sessions_in_phase).toBe(1)

    await deleteWorkoutSession(TEST_USER_ID, completedId)
    row = await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [TEST_USER_ID, programSessionId])
    expect(row.rows[0].sessions_in_phase).toBe(0)
  })
})

// ── Q-8: only FINISHED workouts count toward lifetime totals ──────────────────
describe.skipIf(!canRun)('reconcileUserStats counts completed workouts only (Q-8)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let reconcileUserStats: typeof import('@/lib/data/postgres/slices/user-stats').reconcileUserStats

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    ;({ reconcileUserStats } = await import('@/lib/data/postgres/slices/user-stats'))
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `reconcile-test-${TEST_USER_ID}@example.com`],
    )
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  /** A session with `logs` logged exercises of 100 kg volume each, optionally marked finished. */
  const seed = async (name: string, logs: number, finished: boolean) => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, now(), ${finished ? 'now()' : 'NULL'}) RETURNING id`, [TEST_USER_ID, name])
    const id = ws.rows[0].id
    for (let i = 0; i < logs; i++) {
      const el = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
         VALUES ($1, $2, 100, now()) RETURNING id`, [id, `Ex${i}`])
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 50, 2)`,
        [el.rows[0].id])
    }
    return id
  }

  it('excludes a started-but-never-finished session from sessions, volume AND sets', async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    const done = await seed('Finished', 2, true)
    const abandoned = await seed('Abandoned', 2, false)

    await reconcileUserStats(db, TEST_USER_ID)
    const [row] = (await pool.query(
      `SELECT total_sessions, total_volume_kg, total_sets FROM user_stats WHERE user_id = $1`,
      [TEST_USER_ID])).rows
    // Only the finished session: 1 session, 2 × 100 kg, 2 sets — the abandoned one contributes
    // nothing to ANY of the three, which is the whole point (they used to disagree).
    expect(row.total_sessions).toBe(1)
    expect(Number(row.total_volume_kg)).toBe(200)
    expect(row.total_sets).toBe(2)

    await pool.query(`DELETE FROM workout_sessions WHERE id = ANY($1)`, [[done, abandoned]])
  })

  // Q-177: the only test in this file that executes a whole migration, so it is the only one that
  // needs the lock — and it takes it here rather than in a hook, to hold it for as short a window
  // as possible. Migration 146 is an unrestricted `UPDATE workout_sessions`: it stamps
  // `completed_at` on ANY session with >=3 exercise logs, for every user, so running it while
  // another file has an in-progress session would silently complete that session out from under it.
  it('migration 146 stamps historical finishers (>=3 logs) and leaves real abandons alone', async () => {
    const lock = migrationTestLock(() => pool)
    await lock.acquire()
    try {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    const finisher = await seed('Historical finisher', 3, false)  // 3 logs, no completed_at
    const abandon = await seed('Real abandon', 1, false)          // 1 log, no completed_at

    const sqlText = readFileSync(
      join(process.cwd(), 'lib/data/postgres/migrations/146_backfill_completed_workouts.sql'), 'utf8')
    await pool.query(sqlText)

    const rows = (await pool.query(
      `SELECT id, completed_at FROM workout_sessions WHERE id = ANY($1)`, [[finisher, abandon]])).rows
    const byId = new Map(rows.map(r => [r.id, r.completed_at]))
    expect(byId.get(finisher)).not.toBeNull()
    expect(byId.get(abandon)).toBeNull()

    // Re-running must be a no-op, not a re-stamp — it only ever touches NULLs.
    const before = byId.get(finisher)
    await pool.query(sqlText)
    const after = (await pool.query(`SELECT completed_at FROM workout_sessions WHERE id = $1`, [finisher])).rows[0]
    expect(new Date(after.completed_at).getTime()).toBe(new Date(before).getTime())

    await pool.query(`DELETE FROM workout_sessions WHERE id = ANY($1)`, [[finisher, abandon]])
    } finally {
      await lock.release()
    }
  })
})

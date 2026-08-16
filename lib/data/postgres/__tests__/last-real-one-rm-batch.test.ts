// Q-202: the prescription basis must come from the last NON-DELOAD session.
//
// The owner lowered their weights deliberately to work on form, and the app kept prescribing from
// a lift months old. `resolveWorkingBasis` took `max(lastLog, seed, allTimePr)` and the all-time PR
// is permanent, so no number of consecutive lighter sessions could ever move the prescribed weight.
//
// The other half of that fix is this query. `getLastExerciseLogsBatch` returns the genuinely most
// recent log — which the screen still needs, so it can show what you actually lifted last time —
// and on a deload that row carries `estimated_1rm = 0`, because `estimateOneRm` refuses to
// estimate a 1RM from a deliberately submaximal effort. So the basis needs its own lookup that
// skips those rows and finds the last real one.
//
// `estimated_1rm > 0` was originally the whole deload test — the same call that suppresses the
// estimate covers all three deload markers (a static deload phase, an early-deload week, and the
// AI's per-exercise flag), so one predicate could not fall out of sync with them. **Q-228 showed
// that is a claim about the write path, not a property of the data**: production holds a deload log
// with `estimated_1rm = 85.75`, written before Q-115's fix stamped the flag correctly, and this
// query handed it to the prescription as a real max. So the query now also filters
// `exercise_deloaded = false`, mirroring reconcilePersonalRecord. The last describe block below
// covers that, and it is defence in depth rather than a replacement: the estimate gate still does
// the work on every correctly-written row.
//
// Runs only against a real local dev Postgres — skips in CI, which has no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000002021ba'
const OTHER_USER_ID = '00000000-0000-4000-8000-0000002021bb'
const EX = 'Q202 Lateral Raise'

describe.skipIf(!canRun)('getLastRealOneRmBatch — the prescription basis skips deloads (Q-202)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  // Each session is one workout on its own day, with one exercise log carrying `est`.
  // `est = 0` is exactly what a deload writes.
  async function logSession(userId: string, daysAgo: number, est: number) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q202 Session', now() - ($2 || ' days')::interval) RETURNING id`,
      [userId, String(daysAgo)])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, logged_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval)`,
      [ws.rows[0].id, EX, est, est * 0.8, String(daysAgo)])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, tag] of [[TEST_USER_ID, 'a'], [OTHER_USER_ID, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `q202-basis-${tag}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [TEST_USER_ID, OTHER_USER_ID]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('returns the most recent real session when nothing is deloaded', async () => {
    await logSession(TEST_USER_ID, 20, 100)
    await logSession(TEST_USER_ID, 10, 110)
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.estimated1rm).toBe(110)
  })

  it('skips a more recent DELOAD session and keeps the last real one', async () => {
    // The reported bug, in one assertion: a deload yesterday must not erase the real
    // session before it and send the basis falling back to the all-time PR.
    await logSession(TEST_USER_ID, 1, 0)
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.estimated1rm).toBe(110)
  })

  it('follows a deliberate reduction DOWN, which is the whole point', async () => {
    // A real, lighter session after the deload. The old behaviour kept prescribing 110
    // (and, above that, the all-time PR) forever.
    await logSession(TEST_USER_ID, 0, 72)
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.estimated1rm).toBe(72)
  })

  it('omits an exercise whose only sessions were deloads, rather than reporting 0', async () => {
    // Omission matters: resolveWorkingBasis reads "absent" as "fall back to seed/PR", which
    // is correct here. A stored 0 would read as a real 0 kg basis.
    const DELOAD_ONLY = 'Q202 Deload Only'
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q202 Session', now()) RETURNING id`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
       VALUES ($1, $2, 0, now())`, [ws.rows[0].id, DELOAD_ONLY])

    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [DELOAD_ONLY])
    expect(got.has(DELOAD_ONLY)).toBe(false)
  })

  it('ignores a soft-deleted log', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q202 Session', now()) RETURNING id`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, logged_at, deleted_at)
       VALUES ($1, $2, 999, 799, now(), now())`, [ws.rows[0].id, EX])

    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.estimated1rm).toBe(72)
  })

  it('never reads another user\'s session', async () => {
    await logSession(OTHER_USER_ID, 0, 500)
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.estimated1rm).toBe(72)
  })

  it('carries target_80 from that same real session, so the dial does not pre-fill 0', async () => {
    // target_80 is both the displayed target and the value the weight dial starts at. A deload
    // row stores 0 there too, so reading it off the last log showed "0 kg" for the whole
    // session after a deload — the sibling surface of the basis bug itself.
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [EX])
    expect(got.get(EX)?.target80).toBeCloseTo(72 * 0.8, 5)
  })

  it('returns an empty map for no names, without querying', async () => {
    expect((await repo.getLastRealOneRmBatch(TEST_USER_ID, [])).size).toBe(0)
  })
})

// Q-228. The write-time invariant above ("a deload always stores 0") held in code and failed in
// production: the whole-session AI deload of 2026-08-06 left an Incline Bench Press log at
// estimated_1rm = 85.75 with exercise_deloaded = true, six minutes outside the window migration 168
// audited. resolveWorkingBasis read it as a real max and prescribed 72.5 kg off an 86 kg 1RM, from
// a session whose actual top set was 42.5 kg. Filtering on the flag as well means the next
// write-time regression has a read-time backstop instead of reaching the bar.
describe.skipIf(!canRun)('getLastRealOneRmBatch — a deloaded row is skipped even when it stored a 1RM (Q-228)', () => {
  const POISONED = 'Q228 Incline Press'
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  async function logSession(daysAgo: number, est: number, deloaded: boolean) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q228 Session', now() - ($2 || ' days')::interval) RETURNING id`,
      [TEST_USER_ID, String(daysAgo)])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)`,
      [ws.rows[0].id, POISONED, est, est * 0.8, deloaded, String(daysAgo)])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, 'q202-basis-a@example.com'])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1 AND session_name = 'Q228 Session'`, [TEST_USER_ID])
  })

  it('keeps the older real session when a newer deload row wrongly stored a 1RM', async () => {
    await logSession(14, 78.75, false)   // the true max
    await logSession(7, 85.75, true)     // the straggler: flagged deloaded, 1RM never zeroed
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [POISONED])
    expect(got.get(POISONED)?.estimated1rm).toBe(78.75)
  })

  it('carries target_80 from the real session too, not the poisoned row', async () => {
    // The straggler's target_80 was 44.5 in production — 83% of a load nobody lifted. Taking the
    // 1RM from one row and the dial pre-fill from another would be worse than either alone.
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [POISONED])
    expect(got.get(POISONED)?.target80).toBeCloseTo(78.75 * 0.8, 5)
  })

  it('omits the exercise entirely when its only 1RM-bearing row is deloaded', async () => {
    const ONLY_POISONED = 'Q228 Only Poisoned'
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q228 Session', now()) RETURNING id`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, exercise_deloaded, logged_at)
       VALUES ($1, $2, 85.75, 44.5, true, now())`, [ws.rows[0].id, ONLY_POISONED])

    // Absent, not 85.75 and not 0: resolveWorkingBasis reads absence as "fall back to seed/PR",
    // which is the honest answer when every stored estimate is untrustworthy.
    const got = await repo.getLastRealOneRmBatch(TEST_USER_ID, [ONLY_POISONED])
    expect(got.has(ONLY_POISONED)).toBe(false)
  })
})

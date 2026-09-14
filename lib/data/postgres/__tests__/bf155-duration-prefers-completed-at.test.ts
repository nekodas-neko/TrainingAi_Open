// BF-155 (a). Owner: *"my amrap week all has under 5mins workout time."* A 38.3-minute session
// printed as 3 minutes.
//
// `/api/day-log` reconstructed the session end as `max(loggedAt + timeToComplete)` and never looked
// at `completed_at`. That reconstruction is only as good as its inputs, and its inputs had failed:
// with no `set_end_ms` on any row, `logExerciseFromPayload` stamped every exercise with
// `workoutStartedAt`, so the max returned start-plus-the-single-longest-exercise. `completed_at` was
// correct on the session row the whole time, sitting unread beside it.
//
// **The fixture reproduces the broken shape exactly**: five exercises, every `logged_at` identical
// to the millisecond and equal to `started_at`, which is what production holds for 12 Sep.
//
// Derived from the clock and anchored at MIDDAY of the user's local day — a hardcoded date is a time
// bomb, and midnight is a boundary, which is where an off-by-one stops being visible.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-0000000d0155'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('the printed duration uses the measured end, not a reconstruction (BF-155)', () => {
  let pool: import('pg').Pool
  let localDay: string
  let collapsedId = ''
  let runningId = ''
  let skewedId = ''

  /** The real session length in the fixture, and what the card must print. */
  const REAL_MINUTES = 38
  /** The longest single exercise — what the old reconstruction returned instead. */
  const LONGEST_EXERCISE_SEC = 202

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    localDay = todayInTz(TZ).replace(/-/g, '/')

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'bf155-duration@example.com', TZ],
    )

    const [y, m, d] = localDay.split('/').map(Number)
    // Midday local, in UTC. Brisbane is UTC+10 and never observes DST.
    const started = new Date(Date.UTC(y, m - 1, d, 12 - 10, 0, 0))

    // The broken session: completed_at is correct, every exercise collapsed onto the start.
    const collapsed = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Collapsed', $2, $3) RETURNING id`,
      [USER, started, new Date(started.getTime() + REAL_MINUTES * 60_000)],
    )
    collapsedId = collapsed.rows[0].id
    for (let i = 0; i < 5; i++) {
      // Identical `logged_at` on all five, to the millisecond — the production signature.
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, time_to_complete)
         VALUES ($1, $2, $3, $4)`,
        [collapsedId, `Ex${i}`, started, i === 0 ? LONGEST_EXERCISE_SEC : 90],
      )
    }

    // A session still in progress: no completed_at, so the reconstruction is all there is.
    const running = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Running', $2, NULL) RETURNING id`,
      [USER, new Date(started.getTime() + 3 * 3_600_000)],
    )
    runningId = running.rows[0].id
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, time_to_complete)
       VALUES ($1, 'Ex0', $2, 600)`,
      [runningId, new Date(started.getTime() + 3 * 3_600_000 + 10 * 60_000)],
    )

    // A backward clock step between start and complete. Never seen in production (0 of 110 rows on
    // 2026-09-14) but not impossible, and this codebase already clamps for exactly this in
    // `handleLogCurrentSet`: *"a clock-skew/NTP step can make `now` read before lapStartMs"*.
    // Seeded because a guard nothing exercises is a guard nobody knows is working — this case
    // survived the first mutation pass.
    const skewed = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Skewed', $2, $3) RETURNING id`,
      [USER, new Date(started.getTime() + 6 * 3_600_000),
             new Date(started.getTime() + 6 * 3_600_000 - 5 * 60_000)],
    )
    skewedId = skewed.rows[0].id
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, time_to_complete)
       VALUES ($1, 'Ex0', $2, 300)`,
      [skewedId, new Date(started.getTime() + 6 * 3_600_000 + 8 * 60_000)],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function durations() {
    const { GET } = await import('@/app/api/day-log/route')
    const res = await GET(new Request(`http://localhost/api/day-log?date=${localDay}`) as never)
    expect(res.status).toBe(200)
    return (await res.json()).workoutDurationsById as Record<string, { minutes: number } | null>
  }

  it('the fixture really does hold the broken shape', async () => {
    // Asserted rather than assumed: if the seed stopped collapsing the timestamps, the test below
    // would pass against the old code and prove nothing.
    const { rows } = await pool.query(
      `SELECT count(*)::int n, count(DISTINCT logged_at)::int distinct_stamps
         FROM exercise_logs WHERE workout_session_id = $1`, [collapsedId])
    expect(rows[0].n).toBe(5)
    expect(rows[0].distinct_stamps).toBe(1)
  })

  it('prints the measured length, not start-plus-the-longest-exercise', async () => {
    const byId = await durations()
    expect(byId[collapsedId]?.minutes).toBe(REAL_MINUTES)

    // What the old code returned, kept as the regression's own record: with every stamp on the
    // start, `max(loggedAt + timeToComplete)` is the single longest exercise.
    const reconstructed = Math.round(LONGEST_EXERCISE_SEC / 60)
    expect(reconstructed).toBe(3)
    expect(byId[collapsedId]?.minutes).not.toBe(reconstructed)
  })

  it('still reconstructs for a session that has not finished', async () => {
    // `completed_at` is null mid-session, and the reconstruction is the only answer there. Dropping
    // it in favour of the measured end would blank the duration on the session being logged right
    // now — the one the user is looking at.
    const byId = await durations()
    expect(byId[runningId]?.minutes).toBe(20) // start → 10 min in + a 600 s exercise
  })

  it('ignores a completed_at that precedes the start, rather than printing a negative', async () => {
    // The guard on `completedMs >= startMs`. Without it this renders −5 minutes; with it the
    // reconstruction takes over and gives 13 (8 min in + a 300 s exercise). Seeded because the
    // first mutation pass removed the guard and nothing failed.
    const byId = await durations()
    expect(byId[skewedId]?.minutes).toBe(13)
    expect(byId[skewedId]!.minutes).toBeGreaterThan(0)
  })
})

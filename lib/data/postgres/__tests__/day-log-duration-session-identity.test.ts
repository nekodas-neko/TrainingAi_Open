// Q-362a — `/api/day-log` keyed `workoutDurations` by session NAME, so two `Push` sessions on one
// Brisbane day collapsed to a single key holding only the later window. The earlier session's
// duration was gone, not merged.
//
// The fix shipped additively on purpose. Three Lane B surfaces read the name-keyed record (Q-362b),
// and switching the key outright would have left all three showing NO duration for however long the
// two lanes' PRs were apart. So the route emitted `workoutDurationsById` beside the legacy record
// until those consumers moved — then LA-15 removed the legacy half, which is the state pinned here.
//
// The fixture is derived from the clock and anchored at MIDDAY of the user's local day — a hardcoded
// date is a time bomb, and midnight is a boundary, which is where an off-by-one stops being visible.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-0000000d0106'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('day-log workout durations key on session identity (Q-362a)', () => {
  let pool: import('pg').Pool
  let localDay: string      // YYYY/MM/DD in the user's timezone
  let earlyId: string
  let lateId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    localDay = todayInTz(TZ).replace(/-/g, '/')

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, `day-log-identity@example.com`, TZ],
    )

    // Two sessions with the SAME name on the same local day: 09:00 and 17:00 Brisbane (UTC+10).
    const [y, m, d] = localDay.split('/').map(Number)
    const atLocalHour = (h: number) => new Date(Date.UTC(y, m - 1, d, h - 10, 0, 0))

    for (const [hour, label] of [[9, 'early'], [17, 'late']] as const) {
      const started = atLocalHour(hour)
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'Push', $2, $3) RETURNING id`,
        [USER, started, new Date(started.getTime() + 45 * 60_000)],
      )
      const id = ws.rows[0].id
      if (label === 'early') earlyId = id; else lateId = id
      const el = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, time_to_complete)
         VALUES ($1, 'Bench', $2, 60) RETURNING id`,
        [id, new Date(started.getTime() + 40 * 60_000)],
      )
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
         VALUES ($1, 1, 100, 5)`, [el.rows[0].id])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function dayLog() {
    const { GET } = await import('@/app/api/day-log/route')
    const res = await GET(new Request(`http://localhost/api/day-log?date=${localDay}`) as never)
    expect(res.status).toBe(200)
    return res.json()
  }

  it('the fixture really does put two same-named sessions on one local day', async () => {
    const data = await dayLog()
    const ids = new Set(data.exercises.map((e: { workoutSessionId: string }) => e.workoutSessionId))
    expect(ids.size).toBe(2)
    expect(new Set(data.exercises.map((e: { sessionName: string }) => e.sessionName))).toEqual(new Set(['Push']))
  })

  it('keys a duration per session id, so neither window is lost', async () => {
    const { workoutDurationsById } = await dayLog()
    expect(Object.keys(workoutDurationsById).sort()).toEqual([earlyId, lateId].sort())

    // The earlier session is the one the name-keyed record dropped. Assert its actual window, not
    // just its presence — presence alone would pass if both keys held the later session. The times
    // are `fmtAest` output ("9:00am"), which is why they are compared as exact strings rather than
    // ordered: "5:00pm" sorts before "9:00am".
    expect(workoutDurationsById[earlyId]).toEqual({ start: '9:00am', end: '9:41am', minutes: 41 })
    expect(workoutDurationsById[lateId]).toEqual({ start: '5:00pm', end: '5:41pm', minutes: 41 })
  })

  // LA-15: the legacy name-keyed record is GONE. It was emitted beside the id-keyed one only so the
  // three surfaces reading it kept working while Q-362b moved them over — an expand/migrate/contract,
  // and this is the contract. Asserting its absence is what stops it being reintroduced by a merge.
  it('no longer emits the colliding name-keyed record', async () => {
    const data = await dayLog()
    expect(data.workoutDurations).toBeUndefined()
    expect(Object.keys(data.workoutDurationsById)).toHaveLength(2)
  })
})

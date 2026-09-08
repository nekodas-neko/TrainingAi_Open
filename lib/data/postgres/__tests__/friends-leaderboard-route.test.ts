// PS-39 — `GET /api/friends/leaderboard`, against real rows.
//
// **This route was deliberately left uncovered earlier in the PS-39 sweep**, and the reasoning was
// recorded at the time: its scoping lives inside `inArray(allIds)` across five queries, where a
// mock cannot see it, and a stub would pin canned rows and read as coverage without being any.
// That was right about mocking and wrong as a conclusion — the DB-backed pattern the sweep has
// since established can see exactly that, so the omission is closed here rather than left standing.
//
// The property that made it worth coming back for is a privacy one: **a non-friend must never
// appear on your leaderboard**, and nothing in the codebase checked it. The rest:
//
//   · a friend with no workouts still appears, with zeros — the user list drives the output, not
//     the workout rows;
//   · soft-deleted sessions, exercise logs and set logs are excluded from both totals;
//   · the weekly window starts on Monday in the CALLER's timezone;
//   · `isSelf` marks the caller and nobody else;
//   · BF-122a — the streak's rest allowance is read from each user's OWN schedule, not a hardcoded
//     1. A literal 1 was right only for a rotation: someone training Mon+Tue is compliant across a
//     five-day hole, and their leaderboard streak broke every week.
//
// Two notes from the mutation pass, so the next reader is not misled:
//
//   · **The soft-delete filters are written out TWICE**, once in the weekly query and once in the
//     all-time one. A change that drops only one copy is invisible to a test that checks only the
//     other, which is what the first draft here did — so both totals are asserted wherever one is.
//   · **`maxCompliantRestGapFor`'s rotation early-return is an equivalent mutant.** Deleting it
//     changes no answer: a rotation then falls past the weekly branch (which its own type guard
//     excludes it from) to the same `return 1` at the bottom. It is worth keeping as a statement of
//     intent, and it is not testable through this route.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL

const ME = '00000000-0000-4000-8000-0000000000e6'
const FRIEND = '00000000-0000-4000-8000-0000000000e7'
const STRANGER = '00000000-0000-4000-8000-0000000000e8'
const TZ = 'Australia/Brisbane'

let sessionUser: { id: string; timezone?: string } | null = { id: ME, timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('friends leaderboard — who appears and what they are credited', () => {
  let pool: import('pg').Pool
  let GET: typeof import('@/app/api/friends/leaderboard/route').GET

  const users = [ME, FRIEND, STRANGER]

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ GET } = await import('@/app/api/friends/leaderboard/route'))

    // Email and display name derived FROM the id, so changing an id cannot leave a stale one.
    for (const [id, label] of [[ME, 'Me'], [FRIEND, 'Friend'], [STRANGER, 'Stranger']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone, display_name)
         VALUES ($1, $2, 'x', $3, $4) ON CONFLICT (id) DO NOTHING`,
        [id, `lb-${id}@example.com`, TZ, label])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM friendships WHERE requester_id = ANY($1) OR addressee_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users])
  })

  beforeEach(async () => {
    sessionUser = { id: ME, timezone: TZ }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM friendships WHERE requester_id = ANY($1) OR addressee_id = ANY($1)`, [users])
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [users])
    // The stranger is real and active — they simply are not a friend, which is the whole point.
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')
       ON CONFLICT DO NOTHING`, [ME, FRIEND])
  })

  /** A completed session with one logged exercise and one set, at midday in the user's own zone. */
  const trained = async (userId: string, day: string, opts: {
    weightKg?: number; reps?: number
    sessionDeleted?: boolean; logDeleted?: boolean; setDeleted?: boolean
  } = {}) => {
    const at = new Date(`${day}T12:00:00+10:00`)
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, deleted_at)
       VALUES ($1, 'Upper', $2, $3) RETURNING id`,
      [userId, at, opts.sessionDeleted ? new Date() : null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, muscle_groups, logged_at, deleted_at)
       VALUES ($1, 'Press', ARRAY['chest'], $2, $3) RETURNING id`,
      [ws.id, at, opts.logDeleted ? new Date() : null])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, deleted_at)
       VALUES ($1, 1, $2, $3, $4)`,
      [el.id, opts.weightKg ?? 100, opts.reps ?? 10, opts.setDeleted ? new Date() : null])
  }

  const board = async () =>
    (await (await GET(new Request('http://localhost/api/friends/leaderboard'))).json()).entries as Record<string, unknown>[]
  const entryFor = async (id: string) => (await board()).find(e => e.userId === id)

  /** Today in the user's own zone, so a fixture never lands on the wrong side of a boundary. */
  const today = () => todayInTz(TZ)

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await GET(new Request('http://localhost/api/friends/leaderboard'))).status).toBe(401)
  })

  // The property this file exists for. The stranger trains harder than either of us and must not
  // appear — their being active is what makes the case mean something.
  it('shows friends and self, and never a stranger', async () => {
    await trained(ME, today())
    await trained(FRIEND, today())
    await trained(STRANGER, today(), { weightKg: 500 })

    const ids = (await board()).map(e => e.userId)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(ME)
    expect(ids).toContain(FRIEND)
    expect(ids).not.toContain(STRANGER)
  })

  it('marks only the caller as self', async () => {
    expect((await entryFor(ME))!.isSelf).toBe(true)
    expect((await entryFor(FRIEND))!.isSelf).toBe(false)
  })

  // The user list drives the output, so someone who has never trained still has a row.
  it('lists a friend who has never trained, at zero', async () => {
    await trained(ME, today())
    expect(await entryFor(FRIEND)).toMatchObject({
      weeklySessions: 0, weeklyVolumeKg: 0, allTimeSessions: 0, allTimeVolumeKg: 0,
    })
  })

  it('credits volume as weight times reps', async () => {
    await trained(ME, today(), { weightKg: 60, reps: 5 })
    expect((await entryFor(ME))!.allTimeVolumeKg).toBe(300)
  })

  it('excludes a soft-deleted session, exercise log and set log from the totals', async () => {
    await trained(ME, today(), { sessionDeleted: true })
    await trained(ME, today(), { logDeleted: true })
    await trained(ME, today(), { setDeleted: true })

    const me = (await entryFor(ME))!
    // The deleted SESSION is gone entirely; the deleted log and set leave their session counted
    // with no volume, which is what the left joins say and is worth pinning rather than assuming.
    expect(me.allTimeVolumeKg).toBe(0)
    expect(me.allTimeSessions).toBe(2)
    // Both totals, because the soft-delete filters are written out TWICE — once per query — and a
    // change that drops only one copy is invisible to a test that checks only the other. Not
    // hypothetical: the mutation pass removed the weekly copy and the first draft did not notice.
    expect(me.weeklyVolumeKg).toBe(0)
    expect(me.weeklySessions).toBe(2)
  })

  // A session from before this week counts all-time and not weekly — the one comparison that can
  // tell the two totals apart.
  it('separates this week from all time', async () => {
    await trained(ME, shiftDateStr(today(), -30))
    const me = (await entryFor(ME))!

    expect(me.allTimeSessions).toBe(1)
    expect(me.weeklySessions).toBe(0)
    expect(me.allTimeVolumeKg).toBe(1000)
    expect(me.weeklyVolumeKg).toBe(0)
  })

  it('falls back through display name, name, then Unknown', async () => {
    await pool.query(`UPDATE users SET display_name = NULL, name = 'Fallback Name' WHERE id = $1`, [FRIEND])
    expect((await entryFor(FRIEND))!.displayName).toBe('Fallback Name')

    await pool.query(`UPDATE users SET name = NULL WHERE id = $1`, [FRIEND])
    expect((await entryFor(FRIEND))!.displayName).toBe('Unknown')

    await pool.query(`UPDATE users SET display_name = 'Friend' WHERE id = $1`, [FRIEND])
  })

  /**
   * BF-122a — the rest allowance comes from each user's OWN schedule.
   *
   * Two days of training with a gap that a rotation would break on and a weekly plan would not.
   * The same days are used for both halves, so the schedule is the only thing that varies — which
   * is the only way to tell the allowance is being read rather than hardcoded.
   */
  it('reads the streak\'s rest allowance from the user\'s own schedule', async () => {
    const streakFor = async (type: 'rotation' | 'weekly', dows: number[]) => {
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [ME])
      const { rows: [p] } = await pool.query(
        `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'LB', true) RETURNING id`, [ME])
      const { rows: [ps] } = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Upper', 0) RETURNING id`, [p.id])
      const { rows: [sch] } = await pool.query(
        `INSERT INTO schedules (program_id, type, rest_after_n) VALUES ($1, $2, 1) RETURNING id`, [p.id, type])
      for (const d of dows) {
        await pool.query(
          `INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1, $2, $3)`,
          [sch.id, d, ps.id])
      }
      return (await entryFor(ME))!.allTimeStreak as number
    }

    // FOUR days apart — three rest days between them. The first draft used ADJACENT days, which no
    // allowance can tell apart: zero rest days clears every threshold, so both plans scored 2 and
    // the rule went untested. Three rest days sits above a rotation's allowance of 1 and below a
    // Mon+Tue weekly plan's 5, which is the only band where the two answers differ.
    await trained(ME, shiftDateStr(today(), -8))
    await trained(ME, shiftDateStr(today(), -4))

    // Same days, same rows — only the plan differs.
    const weekly = await streakFor('weekly', [1, 2])     // widest hole Tue→Mon = 5 rest days
    const rotation = await streakFor('rotation', [])     // one rest day, whatever restAfterN says

    expect(weekly).toBe(2)     // the two days join into one streak
    expect(rotation).toBe(1)   // …and break into two
  })

  it('answers no-store', async () => {
    const res = await GET(new Request('http://localhost/api/friends/leaderboard'))
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

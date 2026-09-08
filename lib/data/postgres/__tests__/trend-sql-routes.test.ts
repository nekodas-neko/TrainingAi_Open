// PS-39 — `strength-trend` and `muscle-tonnage-trend`, the two trend reads whose logic IS their SQL.
//
// **These two are tested against real rows because a mock would pin nothing they own.** Both build a
// query by hand rather than going through the repository, and everything that matters lives inside
// it: the `ws.user_id` scope, `deleted_at IS NULL` across three tables, bucketing by the LOCAL
// calendar date rather than the UTC timestamp, and — for tonnage — the main/secondary role
// weighting and the split between library and free-text muscles. A stub answering `db.execute`
// would assert that a string was passed somewhere.
//
// So the cases below are the ones a mock is structurally blind to:
//
//   · another user's identical rows do not appear in either answer;
//   · a soft-deleted session, exercise log or set log is absent from the totals;
//   · a secondary muscle counts at half weight and a main one at full;
//   · two library labels that normalise to one muscle are ONE trend line, not two;
//   · the gain percentage needs two points.
//
// One guard is deliberately NOT covered and it is worth saying why: `startRm > 0` in the gain
// calculation is unreachable, because the query already filters `estimated_1rm > 0`, so nothing a
// zero could ride in on ever reaches the JS. A test for it would assert a state the route cannot
// produce.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL

const TZ = 'Australia/Brisbane'
const OWNER = '00000000-0000-4000-8000-0000000000f2'
const STRANGER = '00000000-0000-4000-8000-0000000000f3'
const PROGRAM = '00000000-0000-4000-8000-0000000000f4'
const PROG_SESSION = '00000000-0000-4000-8000-0000000000f5'

const PRESS = 'Trend Test Press'
const ROW = 'Trend Test Row'
const FREEFORM = 'Trend Test Freeform Lift'

let sessionUser: { id: string; timezone?: string } | null = { id: OWNER, timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('trend routes whose logic is their SQL', () => {
  let pool: import('pg').Pool
  let getStrength: typeof import('@/app/api/strength-trend/route').GET
  let getTonnage: typeof import('@/app/api/muscle-tonnage-trend/route').GET

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ GET: getStrength } = await import('@/app/api/strength-trend/route'))
    ;({ GET: getTonnage } = await import('@/app/api/muscle-tonnage-trend/route'))

    // Email derived FROM the id, so changing an id later cannot leave a stale one behind.
    for (const id of [OWNER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `trend-${id}@example.com`])
    }
    // PRESS carries a main and a secondary muscle; ROW's "abs" normalises onto the same canonical
    // muscle as PRESS's "core", which is what makes the one-line-not-two case real.
    await pool.query(
      `INSERT INTO exercise_library (name, muscles) VALUES
         ($1, '[{"muscle":"chest","role":"main"},{"muscle":"core","role":"secondary"}]'::jsonb),
         ($2, '[{"muscle":"abs","role":"main"}]'::jsonb)
       ON CONFLICT (name) DO NOTHING`, [PRESS, ROW])

    await pool.query(
      `INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'Trend Test', true)
       ON CONFLICT (id) DO NOTHING`, [PROGRAM, OWNER])
    await pool.query(
      `INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'Upper', 0)
       ON CONFLICT (id) DO NOTHING`, [PROG_SESSION, PROGRAM])
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES
         ($1, $2, ARRAY['chest'], 0), ($1, $3, ARRAY['abs'], 1)
       ON CONFLICT DO NOTHING`, [PROG_SESSION, PRESS, ROW])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM programs WHERE id = $1`, [PROGRAM])
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[PRESS, ROW]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    sessionUser = { id: OWNER, timezone: 'Australia/Brisbane' }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
  })

  /** One logged exercise with one set, at a wall-clock time in the user's own zone. */
  const logSet = async (opts: {
    user?: string; name?: string; muscleGroups?: string[]; at: Date
    rm?: number | null; weightKg?: number; reps?: number
    sessionDeleted?: boolean; logDeleted?: boolean; setDeleted?: boolean
  }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, deleted_at)
       VALUES ($1, 'Upper', $2, $3) RETURNING id`,
      [opts.user ?? OWNER, opts.at, opts.sessionDeleted ? new Date() : null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, muscle_groups, logged_at, estimated_1rm, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ws.id, opts.name ?? PRESS, opts.muscleGroups ?? ['chest'], opts.at,
       opts.rm === undefined ? 100 : opts.rm, opts.logDeleted ? new Date() : null])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, deleted_at)
       VALUES ($1, 1, $2, $3, $4)`,
      [el.id, opts.weightKg ?? 100, opts.reps ?? 10, opts.setDeleted ? new Date() : null])
  }

  /**
   * Midday N days ago in Brisbane — inside every window under test and never on a boundary.
   *
   * The local day is derived with `shiftDateStr(todayInTz(TZ), -n)` rather than by slicing an ISO
   * string: the slice returns the UTC day, which is yesterday's before 10am here, so the fixture
   * would silently land a day early for part of every day. Midday, not midnight, for the same
   * reason — a boundary is where an off-by-one stops being visible.
   */
  const recently = (daysAgo = 2) => new Date(`${shiftDateStr(todayInTz(TZ), -daysAgo)}T12:00:00+10:00`)

  const strength = async () => (await getStrength()).json()
  const tonnage = async () => (await getTonnage()).json()

  describe('/api/strength-trend', () => {
    it('refuses without a session', async () => {
      sessionUser = null
      expect((await getStrength()).status).toBe(401)
    })

    it("does not read another user's logs, even for the same exercise", async () => {
      await logSet({ user: STRANGER, at: recently(), rm: 300 })
      expect((await strength()).exercises).toEqual([])

      await logSet({ at: recently(), rm: 100 })
      const mine = (await strength()).exercises
      expect(mine).toHaveLength(1)
      expect(mine[0].history.map((h: { rm: number }) => h.rm)).toEqual([100])
    })

    it('leaves out a soft-deleted session and a soft-deleted exercise log', async () => {
      await logSet({ at: recently(3), rm: 100 })
      await logSet({ at: recently(2), rm: 200, sessionDeleted: true })
      await logSet({ at: recently(1), rm: 300, logDeleted: true })

      const [entry] = (await strength()).exercises
      expect(entry.history.map((h: { rm: number }) => h.rm)).toEqual([100])
      expect(entry.peakRm).toBe(100)
    })

    it('needs two points before it reports a gain', async () => {
      await logSet({ at: recently(3), rm: 100 })
      expect((await strength()).exercises[0].gainPct).toBeNull()

      await logSet({ at: recently(1), rm: 110 })
      const [entry] = (await strength()).exercises
      expect(entry.gainPct).toBe(10)
      expect(entry.startRm).toBe(100)
      expect(entry.currentRm).toBe(110)
    })

    // The window is 90 days, and a fixture two days old cannot tell that from a week.
    it('reaches back three months, not a week', async () => {
      await logSet({ at: recently(60), rm: 100 })
      await logSet({ at: recently(1), rm: 120 })

      const [entry] = (await strength()).exercises
      expect(entry.history).toHaveLength(2)
      expect(entry.startRm).toBe(100)
    })

    it('takes the best estimate per day rather than the last one logged', async () => {
      const day = recently(2)
      await logSet({ at: day, rm: 120 })
      await logSet({ at: new Date(day.getTime() + 3_600_000), rm: 90 })

      const [entry] = (await strength()).exercises
      expect(entry.history).toHaveLength(1)
      expect(entry.history[0].rm).toBe(120)
    })

    it('answers an empty list when the program has no exercises to trend', async () => {
      await pool.query(`UPDATE programs SET is_active = false WHERE id = $1`, [PROGRAM])
      try {
        expect((await strength()).exercises).toEqual([])
      } finally {
        await pool.query(`UPDATE programs SET is_active = true WHERE id = $1`, [PROGRAM])
      }
    })
  })

  describe('/api/muscle-tonnage-trend', () => {
    it('refuses without a session', async () => {
      sessionUser = null
      expect((await getTonnage()).status).toBe(401)
    })

    it('answers six weeks, oldest first, ending on this week', async () => {
      const body = await tonnage()
      expect(body.weekStarts).toHaveLength(6)
      for (let i = 1; i < 6; i++) {
        const gap = (Date.parse(`${body.weekStarts[i]}T00:00:00Z`) - Date.parse(`${body.weekStarts[i - 1]}T00:00:00Z`)) / 86_400_000
        expect(gap).toBe(7)
      }
    })

    it("does not count another user's tonnage", async () => {
      await logSet({ user: STRANGER, at: recently(), weightKg: 100, reps: 10 })
      expect(await (await tonnage()).muscles).toEqual({})
    })

    // Main at full weight, secondary at half — the same rule the weekly-sets path applies.
    it('weights a secondary muscle at half', async () => {
      await logSet({ at: recently(), weightKg: 100, reps: 10 })  // 1000 kg on PRESS
      const { muscles } = await tonnage()

      expect(muscles.chest.reduce((a: number, b: number) => a + b, 0)).toBe(1000)
      // `core` is PRESS's secondary and normalises with `abs`; half of 1000.
      const coreKey = Object.keys(muscles).find(k => k !== 'chest')!
      expect(muscles[coreKey].reduce((a: number, b: number) => a + b, 0)).toBe(500)
    })

    // "core" and "abs" are one muscle; the raw labels would draw two lines for one thing.
    it('merges labels that normalise to one muscle into one line', async () => {
      await logSet({ at: recently(), name: PRESS, weightKg: 100, reps: 10 })   // core, secondary → 500
      await logSet({ at: recently(), name: ROW, weightKg: 100, reps: 10 })     // abs, main → 1000

      const { muscles } = await tonnage()
      const merged = Object.keys(muscles).filter(k => k !== 'chest')
      expect(merged).toHaveLength(1)
      expect(muscles[merged[0]].reduce((a: number, b: number) => a + b, 0)).toBe(1500)
    })

    it('leaves out soft-deleted sessions, logs and sets', async () => {
      await logSet({ at: recently(), weightKg: 100, reps: 10, sessionDeleted: true })
      await logSet({ at: recently(), weightKg: 100, reps: 10, logDeleted: true })
      await logSet({ at: recently(), weightKg: 100, reps: 10, setDeleted: true })
      expect(await (await tonnage()).muscles).toEqual({})
    })

    // An exercise absent from the library falls back to its own `muscle_groups`, at full weight —
    // the two queries must not both claim it.
    it('counts a free-text exercise once, from its own muscle groups', async () => {
      await logSet({ at: recently(), name: FREEFORM, muscleGroups: ['quads'], weightKg: 60, reps: 5 })
      const { muscles } = await tonnage()
      expect(muscles.quads.reduce((a: number, b: number) => a + b, 0)).toBe(300)
    })

    it('answers no-store', async () => {
      expect((await getTonnage()).headers.get('Cache-Control')).toBe('private, no-store')
    })
  })
})

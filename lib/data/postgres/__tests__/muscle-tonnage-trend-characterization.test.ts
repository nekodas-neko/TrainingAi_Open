/**
 * #2420 — `/api/muscle-tonnage-trend` reads the shared muscle-attribution query, and answers exactly
 * what it answered when it carried its own copy.
 *
 * `legacyTonnageTrend` below is the route's pre-#2420 SQL and post-processing, copied verbatim. It is
 * the oracle: for the same rows, the route must return byte-identical JSON. This file was run against
 * the old route first (where both sides are the same code) to prove the hand-written expectations,
 * then against the new one.
 *
 * The fixture covers what the attribution owns and a mock could not see: main/secondary library
 * roles, two library labels that normalise to one muscle, free-text tags, bodyweight (zero-load) sets
 * that must still draw a flat line, both edges of the six-week range, a week boundary at local
 * midnight, a future log, soft deletes, another user's rows — and the LA-118 split (a session started
 * at 22:00 yesterday whose sets were logged at 00:30 today), which the trend attributes by the set's
 * own `logged_at`. It runs in two non-UTC zones, one of them with DST and a negative offset, because
 * a week boundary that is only right in UTC+10 is the defect this protects against.
 *
 * Runs only against a real local dev Postgres — skips in CI, like its siblings here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { todayInTz, shiftDateStr, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-000000002420'
const STRANGER = '00000000-0000-4000-8000-000000002421'

const PRESS = 'T2420 Press'       // chest main, core secondary
const ROW = 'T2420 Crunch'        // abs main — normalises onto PRESS's core
const FLY = 'T2420 Fly'           // chest main only, so boundary arithmetic is exact
const DIP = 'T2420 Bodyweight Dip' // library, triceps main, always 0 kg
const FREEFORM = 'T2420 Freeform Lunge'    // not in the library: tags quads + glutes
const PULLUP = 'T2420 Freeform Pullup'     // not in the library, 0 kg: tags lats

const WEEKS = 6

let sessionUser: { id: string; timezone?: string } | null = { id: OWNER }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

type Body = { weekStarts: string[]; muscles: Record<string, number[]> }

describe.skipIf(!canRun)('muscle-tonnage-trend — identical answer through the shared attribution query', () => {
  let pool: import('pg').Pool
  let GET: typeof import('@/app/api/muscle-tonnage-trend/route').GET

  /**
   * The pre-#2420 route body, verbatim apart from `db.execute(sql…)` → `pool.query($n)`. `$5`
   * repeats `$1` as a separate untyped parameter, because drizzle binds each interpolation
   * separately and the range comparison is text against text.
   */
  const legacyTonnageTrend = async (userId: string, tz: string): Promise<Body> => {
    const thisWeekStart = startOfWeekInTz(tz)
    const weekStarts = Array.from({ length: WEEKS }, (_, i) => shiftDateStr(thisWeekStart, -7 * (WEEKS - 1 - i)))
    const rangeStart = weekStarts[0]
    const rangeEndExclusive = shiftDateStr(todayInTz(tz), 1)

    const libRows = await pool.query<{ muscle: string; week_start: string; tonnage_kg: number }>(`
      SELECT
        LOWER(muscle_entry->>'muscle') AS muscle,
        to_char(
          $1::date + ((to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD')::date - $1::date) / 7) * 7,
          'YYYY-MM-DD'
        ) AS week_start,
        SUM((sl.weight_kg * sl.reps) * CASE WHEN muscle_entry->>'role' = 'main' THEN 1.0 ELSE 0.5 END)::float AS tonnage_kg
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      JOIN set_logs sl ON sl.exercise_log_id = el.id
      CROSS JOIN LATERAL jsonb_array_elements(
        (SELECT muscles FROM exercise_library WHERE name = el.exercise_name)
      ) AS muscle_entry
      WHERE ws.user_id = $3::uuid
        AND to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD') >= $5
        AND to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD') < $4
        AND EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
      GROUP BY muscle, week_start
    `, [rangeStart, tz, userId, rangeEndExclusive, rangeStart])

    const nonLibRows = await pool.query<{ muscle: string; week_start: string; tonnage_kg: number }>(`
      SELECT
        LOWER(mg) AS muscle,
        to_char(
          $1::date + ((to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD')::date - $1::date) / 7) * 7,
          'YYYY-MM-DD'
        ) AS week_start,
        SUM(sl.weight_kg * sl.reps)::float AS tonnage_kg
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      JOIN set_logs sl ON sl.exercise_log_id = el.id
      CROSS JOIN LATERAL unnest(el.muscle_groups) AS mg
      WHERE ws.user_id = $3::uuid
        AND to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD') >= $5
        AND to_char((el.logged_at AT TIME ZONE $2), 'YYYY-MM-DD') < $4
        AND el.muscle_groups IS NOT NULL
        AND array_length(el.muscle_groups, 1) > 0
        AND NOT EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
      GROUP BY muscle, week_start
    `, [rangeStart, tz, userId, rangeEndExclusive, rangeStart])

    const muscles: Record<string, number[]> = {}
    for (const row of [...libRows.rows, ...nonLibRows.rows]) {
      if (!row.muscle) continue
      const weekIdx = weekStarts.indexOf(row.week_start)
      if (weekIdx === -1) continue
      const muscle = normalizeMuscle(row.muscle)
      if (!muscles[muscle]) muscles[muscle] = new Array(WEEKS).fill(0)
      muscles[muscle][weekIdx] += Number(row.tonnage_kg)
    }
    return { weekStarts, muscles }
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ GET } = await import('@/app/api/muscle-tonnage-trend/route'))

    for (const id of [OWNER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `t2420-${id}@example.com`])
    }
    await pool.query(
      `INSERT INTO exercise_library (name, muscles) VALUES
         ($1, '[{"muscle":"chest","role":"main"},{"muscle":"core","role":"secondary"}]'::jsonb),
         ($2, '[{"muscle":"abs","role":"main"}]'::jsonb),
         ($3, '[{"muscle":"chest","role":"main"}]'::jsonb),
         ($4, '[{"muscle":"triceps","role":"main"}]'::jsonb)
       ON CONFLICT (name) DO NOTHING`, [PRESS, ROW, FLY, DIP])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[PRESS, ROW, FLY, DIP]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
  })

  /** One session, one exercise log, any number of sets — at wall-clock times in `tz`. */
  const log = async (tz: string, opts: {
    user?: string; name: string; muscleGroups?: string[]
    day: string; time?: string; startedDay?: string; startedTime?: string
    sets: [weightKg: number, reps: number][]
    sessionDeleted?: boolean; logDeleted?: boolean; setDeleted?: boolean
  }) => {
    const loggedAt = fromZonedTime(`${opts.day}T${opts.time ?? '12:00:00'}`, tz)
    const startedAt = opts.startedDay
      ? fromZonedTime(`${opts.startedDay}T${opts.startedTime ?? '12:00:00'}`, tz)
      : loggedAt
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, deleted_at)
       VALUES ($1, 'T2420', $2, $3) RETURNING id`,
      [opts.user ?? OWNER, startedAt, opts.sessionDeleted ? new Date() : null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, muscle_groups, logged_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ws.id, opts.name, opts.muscleGroups ?? [], loggedAt, opts.logDeleted ? new Date() : null])
    let n = 1
    for (const [weightKg, reps] of opts.sets) {
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, deleted_at) VALUES ($1, $2, $3, $4, $5)`,
        [el.id, n++, weightKg, reps, opts.setDeleted ? new Date() : null])
    }
  }

  const seed = async (tz: string) => {
    const thisWeek = startOfWeekInTz(tz)
    const W = Array.from({ length: WEEKS }, (_, i) => shiftDateStr(thisWeek, -7 * (WEEKS - 1 - i)))
    const today = todayInTz(tz)

    // Library roles + a non-dyadic load, so float handling is part of what is compared.
    await log(tz, { name: PRESS, day: shiftDateStr(W[2], 2), sets: [[62.5, 8], [22.7, 7], [22.7, 6]] })
    // abs (main) normalises onto PRESS's core (secondary): one line.
    await log(tz, { name: ROW, day: shiftDateStr(W[3], 1), sets: [[40, 12], [17.3, 9]] })
    // Free-text tags, full weight on each.
    await log(tz, { name: FREEFORM, muscleGroups: ['quads', 'glutes'], day: shiftDateStr(W[4], 3), sets: [[101.3, 5], [33.33, 3]] })
    // Bodyweight: zero load still draws the muscle, flat.
    await log(tz, { name: DIP, day: shiftDateStr(W[1], 1), sets: [[0, 12], [0, 10]] })
    await log(tz, { name: PULLUP, muscleGroups: ['lats'], day: shiftDateStr(W[1], 4), sets: [[0, 8]] })

    // Range edges: the last minutes before the window (out) and the first after it opens (in).
    await log(tz, { name: FLY, day: shiftDateStr(W[0], -1), time: '23:30:00', sets: [[100, 10]] })
    await log(tz, { name: FLY, day: W[0], time: '00:30:00', sets: [[10, 10]] })
    // The week boundary at local midnight between last week and this one.
    await log(tz, { name: FLY, day: shiftDateStr(W[5], -1), time: '23:30:00', sets: [[30, 7]] })
    await log(tz, { name: FLY, day: W[5], time: '00:30:00', sets: [[50, 3]] })
    // A future log never counts.
    await log(tz, { name: FLY, day: shiftDateStr(today, 1), sets: [[999, 9]] })
    // LA-118: started 22:00 yesterday, logged 00:30 today — the set's own day is today.
    await log(tz, {
      name: FLY, day: today, time: '00:30:00',
      startedDay: shiftDateStr(today, -1), startedTime: '22:00:00', sets: [[20, 2]],
    })

    // Absent from the answer.
    await log(tz, { name: FLY, day: shiftDateStr(W[3], 2), sets: [[500, 5]], sessionDeleted: true })
    await log(tz, { name: FLY, day: shiftDateStr(W[3], 2), sets: [[500, 5]], logDeleted: true })
    await log(tz, { name: FLY, day: shiftDateStr(W[3], 2), sets: [[500, 5]], setDeleted: true })
    await log(tz, { user: STRANGER, name: FLY, day: shiftDateStr(W[3], 2), sets: [[700, 7]] })
    await log(tz, { user: STRANGER, name: FREEFORM, muscleGroups: ['quads'], day: shiftDateStr(W[3], 2), sets: [[700, 7]] })

    return { W, today }
  }

  for (const tz of ['Australia/Brisbane', 'America/Los_Angeles']) {
    describe(tz, () => {
      beforeEach(() => { sessionUser = { id: OWNER, timezone: tz } })

      it('returns exactly what the pre-#2420 route returned', async () => {
        await seed(tz)
        const res = await GET()
        const text = await res.text()
        const legacy = await legacyTonnageTrend(OWNER, tz)
        expect(JSON.parse(text)).toStrictEqual(legacy)
        // Byte-identical, not merely deep-equal: key order is part of the payload a cache stores.
        expect(text).toBe(JSON.stringify(legacy))
        expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      })

      it('buckets by the local calendar date, and attributes a set by its own logged_at', async () => {
        const { W, today } = await seed(tz)
        const { weekStarts, muscles } = (await (await GET()).json()) as Body
        expect(weekStarts).toEqual(W)

        const todayIdx = W.findIndex((w, i) => today >= w && (i === WEEKS - 1 || today < W[i + 1]))
        expect(todayIdx).toBe(WEEKS - 1)

        // Chest: FLY's edge cases plus PRESS in week 2.
        expect(muscles.chest[0]).toBe(100)            // 00:30 on the first day; 23:30 before it is out
        expect(muscles.chest[1]).toBe(0)
        expect(muscles.chest[2]).toBeCloseTo(500 + 22.7 * 13, 9)
        expect(muscles.chest[3]).toBe(0)              // only deleted / other users' rows there
        expect(muscles.chest[4]).toBe(210)            // Sunday 23:30 stays in last week
        expect(muscles.chest[5]).toBe(150 + 40)       // Monday 00:30 + the LA-118 set; tomorrow is out

        // Bodyweight sets keep their muscle on the chart, flat.
        expect(muscles.triceps).toEqual([0, 0, 0, 0, 0, 0])
        expect(muscles.lats).toEqual([0, 0, 0, 0, 0, 0])

        // Free text: full weight per tag, and the stranger's quads are not here.
        expect(muscles.quads[4]).toBeCloseTo(506.5 + 99.99, 9)
        expect(muscles.glutes[4]).toBeCloseTo(506.5 + 99.99, 9)

        // core (PRESS secondary, half) + abs (ROW main) are one line.
        const coreKey = normalizeMuscle('core')
        expect(normalizeMuscle('abs')).toBe(coreKey)
        expect(muscles[coreKey][2]).toBeCloseTo((500 + 22.7 * 13) / 2, 9)
        expect(muscles[coreKey][3]).toBeCloseTo(480 + 17.3 * 9, 9)
      })
    })
  }
})

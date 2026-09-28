// RV-219 ① — Health → Day showed a chin-up as "0 kg". The repo already has the resolver
// (`isBodyweightType`, `packages/shared/src/1rm.ts`), but `DayExercise` carried no exercise type, so
// the card had nothing to pass it. This pins the route now carrying `exercise_library.exercise_type`,
// resolved through `exercise_logs.exercise_id`, and null for a log that names no library row.
//
// Fixture anchored at midday of the user's local day, derived from the clock — never a hardcoded date.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000219001'
const TZ = 'Australia/Brisbane'
const BW_NAME = 'RV219 Test Chin-Up'
const WT_NAME = 'RV219 Test Bench'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('day-log carries each exercise’s type (RV-219)', () => {
  let pool: import('pg').Pool
  let localDay: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    localDay = todayInTz(TZ).replace(/-/g, '/')

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'rv219-day-log@example.com', TZ],
    )
    const lib = await pool.query(
      `INSERT INTO exercise_library (name, exercise_type) VALUES ($1, 'bodyweight'), ($2, 'weighted')
       ON CONFLICT (name) DO UPDATE SET exercise_type = EXCLUDED.exercise_type
       RETURNING id, name`,
      [BW_NAME, WT_NAME],
    )
    const idOf = (n: string) => lib.rows.find(r => r.name === n).id

    const [y, m, d] = localDay.split('/').map(Number)
    const started = new Date(Date.UTC(y, m - 1, d, 12 - 10, 0, 0))
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Pull', $2, $3) RETURNING id`,
      [USER, started, new Date(started.getTime() + 45 * 60_000)],
    )
    const rows: [string, string | null][] = [[BW_NAME, idOf(BW_NAME)], [WT_NAME, idOf(WT_NAME)], ['RV219 Unlinked', null]]
    for (const [i, [name, exerciseId]] of rows.entries()) {
      const el = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, logged_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [ws.rows[0].id, name, exerciseId, new Date(started.getTime() + (i + 1) * 60_000)],
      )
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 0, 8)`, [el.rows[0].id])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[BW_NAME, WT_NAME]])
  })

  it('names the type, so the card can tell a chin-up from a lift at 0 kg', async () => {
    const { GET } = await import('@/app/api/day-log/route')
    const res = await GET(new Request(`http://localhost/api/day-log?date=${localDay}`) as never)
    expect(res.status).toBe(200)
    const body = await res.json() as { exercises: { name: string; exerciseType: string | null }[] }
    const typeOf = (n: string) => body.exercises.find(e => e.name === n)?.exerciseType
    expect(typeOf(BW_NAME)).toBe('bodyweight')
    expect(typeOf(WT_NAME)).toBe('weighted')
    expect(typeOf('RV219 Unlinked')).toBeNull()
  })
})

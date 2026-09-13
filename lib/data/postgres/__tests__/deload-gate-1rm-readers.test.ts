// The two-marker deload gate (LA-96). `estimated_1rm > 0` alone trusts the write-time invariant
// that a deloaded exercise always stores 0; production has broken that invariant in both
// directions, so every reader that treats an estimate as a real max checks `exercise_deloaded`
// too. `getLastRealOneRmBatch` and `reconcilePersonalRecord` always did; the four readers below
// did not until LA-96.
//
// The fixture that matters is the one with NO exposure in current data: a non-zero estimate on a
// row flagged deloaded. `> 0` admits it; only the second marker rejects it.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job
// has no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-00000000de10'
const EXERCISE = 'Deload Gate Bench'
// getYearReviewTopExercises reads first1rm and last1rm through two separate FILTER clauses, so one
// exercise can only ever witness one of them. This second exercise opens its year on the deload.
const EXERCISE_FIRST = 'Deload Gate Row'
const TZ = 'Australia/Brisbane'

// Derived from the clock, never hardcoded: `getExercise1rmHistory` filters on a rolling
// `NOW() - INTERVAL '90 days'` window, so a fixed date is a test that goes red on a known day.
// 02:00 UTC is midday in Brisbane (UTC+10, no DST) — a day's middle, not its boundary.
function localDayNoonUtc(daysAgo: number): { day: string; iso: string } {
  const at = new Date(Date.now() - daysAgo * 86_400_000)
  const day = formatInTimeZone(at, TZ, 'yyyy-MM-dd')
  return { day, iso: `${day}T02:00:00Z` }
}

// Three day slots, oldest first. Which one carries the deload is what each fixture varies: a
// deload in the MIDDLE of a series is invisible to getYearReviewTopExercises, whose first1rm and
// last1rm pick the extremes by logged_at, so the gate can be deleted there and a middle-deload
// test still passes.
const DAY_OLD = localDayNoonUtc(30)
const DAY_MID = localDayNoonUtc(20)
const DAY_NEW = localDayNoonUtc(10)

describe.skipIf(!canRun)('1RM readers — deloaded log carrying a non-zero estimate', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `deload-gate-${TEST_USER_ID}@example.com`, TZ],
    )

    // The newest row is the violated invariant: flagged deloaded, but its estimate was written
    // anyway and is the highest of the three. Every reader must skip it. Landing on the last
    // logged session is the shape the production incident took.
    const logs: [{ day: string; iso: string }, number, boolean][] = [
      [DAY_OLD, 80, false],
      [DAY_MID, 90, false],
      [DAY_NEW, 100, true],
    ]
    // Same violation, moved to the OLDEST row, so it lands in first1rm instead of last1rm.
    const firstLogs: [{ day: string; iso: string }, number, boolean][] = [
      [DAY_OLD, 100, true],
      [DAY_MID, 70, false],
      [DAY_NEW, 85, false],
    ]
    for (const [name, set] of [[EXERCISE, logs], [EXERCISE_FIRST, firstLogs]] as const)
    for (const [when, rm, deloaded] of set) {
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'Deload Gate Test', $2::timestamptz, $2::timestamptz + interval '1 hour') RETURNING id`,
        [TEST_USER_ID, when.iso],
      )
      const el = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, exercise_deloaded)
         VALUES ($1, $2, $3, 500, $4::timestamptz, $5) RETURNING id`,
        [ws.rows[0].id, name, rm, when.iso, deloaded],
      )
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, reps, weight_kg) VALUES ($1, 1, 8, 60)`,
        [el.rows[0].id],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('getExercise1rmHistory omits the deloaded point entirely', async () => {
    const hist = await repo.getExercise1rmHistory(TEST_USER_ID, [EXERCISE], TZ)
    const points = hist[EXERCISE] ?? []
    expect(points.map(p => p.rm)).toEqual([80, 90])
    expect(points.map(p => p.date)).toEqual([DAY_OLD.day, DAY_MID.day])
  })

  it('listRecent1rm reads past the deloaded row for both latest and previous', async () => {
    const recent = await repo.listRecent1rm(TEST_USER_ID)
    const entry = recent.get(EXERCISE)
    expect(entry).toBeDefined()
    // Without the gate `latest` is 100 (the deload) and `previous` is 80 — an invented PR.
    expect(Number(entry!.latest)).toBe(90)
    expect(Number(entry!.previous)).toBe(80)
  })

  it('getYearReviewTopExercises reads past the deloaded row', async () => {
    const from = new Date(Date.now() - 200 * 86_400_000)
    const row = (await repo.getYearReviewTopExercises(TEST_USER_ID, from, 10))
      .find(r => r.exerciseName === EXERCISE)
    expect(row).toBeDefined()
    expect(Number(row!.first1rm)).toBe(80)
    // Without the gate this is 100 — the deload is the most recent log, so it lands in `last1rm`.
    expect(Number(row!.last1rm)).toBe(90)
    // The deload's sets still count as training done — the gate is on the aggregate, not the row.
    expect(Number(row!.setCount)).toBe(3)
  })

  it('getYearReviewTopExercises reads past a deload that OPENS the year', async () => {
    const from = new Date(Date.now() - 200 * 86_400_000)
    const row = (await repo.getYearReviewTopExercises(TEST_USER_ID, from, 10))
      .find(r => r.exerciseName === EXERCISE_FIRST)
    expect(row).toBeDefined()
    // Without the gate on the first1rm filter this is 100, and the year reads as a 15 kg loss.
    expect(Number(row!.first1rm)).toBe(70)
    expect(Number(row!.last1rm)).toBe(85)
  })
})

// The fourth reader is /api/strength-trend, which carried a byte-identical copy of
// getExercise1rmHistory's query and so missed the gate. It now delegates; this keeps it that way,
// and needs no database.
describe('/api/strength-trend delegates its 1RM history query', () => {
  const src = readFileSync('app/api/strength-trend/route.ts', 'utf8')

  it('calls the repository helper', () => {
    expect(src).toContain('repo.getExercise1rmHistory(')
  })

  it('holds no exercise_logs query of its own', () => {
    expect(src.toLowerCase()).not.toContain('from exercise_logs')
  })
})

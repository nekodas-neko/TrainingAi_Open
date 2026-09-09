// LB-98 — the per-set rest pairs the Rest-vs-plan card needs when the local store is absent.
//
// The gap this closes is a VERIFICATION one, not a product one. `planned_rest_sec` is the snapshot
// taken when a set was logged and it lived only in the device's local store, so in a browser — and
// therefore in CI — the card could only ever render its empty state. Every such card shipped owing a
// device check.
//
// Two properties are worth pinning, and they are the ones a refactor would quietly break:
//
//   · **The pairs are the LOGGED columns, not today's style.** The buckets in the same response are
//     built from the CURRENT progression style, which answers a different question. If these two
//     ever come from one source, a style edit silently rewrites what "prescribed" meant for every
//     past set — which is the whole reason the card reads the snapshot.
//   · **Only sets carrying both are emitted.** `restByPrescription` discards the others (a
//     prescription of 0 is "no rest planned", not a target), so shipping them is payload for
//     nothing — and a null slipping into the list would reach that helper as a real pair.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000e5701'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

const get = async () => {
  const { GET } = await import('../route')
  const res = await GET(new Request('http://localhost/api/health-trends?view=rest-adherence') as never)
  return res.json()
}

describe.skipIf(!canRun)('health-trends rest-adherence per-set pairs (LB-98)', () => {
  let pool: import('pg').Pool
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `restsets-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  /** One session `daysAgo`, carrying the given (planned, actual) rest pairs as logged sets. */
  async function session(daysAgo: number, pairs: [number | null, number | null][]) {
    const startedAt = new Date(mid.getTime() - daysAgo * 86_400_000 + 10 * 3_600_000)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Session', $2, $3) RETURNING id`,
      [TEST_USER_ID, startedAt, new Date(startedAt.getTime() + 3_600_000)],
    )
    const ex = await pool.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, volume)
       VALUES ($1, 'Bench Press', $2, 1000) RETURNING id`,
      [rows[0].id, startedAt],
    )
    let n = 0
    for (const [planned, actual] of pairs) {
      n += 1
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_rest_sec, rest_time_sec)
         VALUES ($1, $2, 60, 8, $3, $4)`,
        [ex.rows[0].id, n, planned, actual],
      )
    }
  }

  it('publishes the logged pairs so a browser can read what only the device could', async () => {
    await session(3, [[90, 105], [120, 118]])

    const data = await get()

    expect(data.restSets).toEqual(
      expect.arrayContaining([
        { plannedRestSec: 90, restTimeSec: 105 },
        { plannedRestSec: 120, restTimeSec: 118 },
      ]),
    )
    expect(data.restSets).toHaveLength(2)
  })

  // A set with only one half of the pair is useless to `restByPrescription` and would arrive there
  // looking like a real measurement. 61% of production's set logs are missing the planned value.
  it('drops a set missing either half rather than emitting a half-pair', async () => {
    await session(3, [[90, 105], [null, 118], [120, null], [null, null]])

    const data = await get()

    expect(data.restSets).toEqual([{ plannedRestSec: 90, restTimeSec: 105 }])
  })

  // "No rest planned" is not a target to compare against, and dividing by it is how a ratio becomes
  // Infinity. The shared helper already refuses it; the route must not hand it over in the first place.
  it('drops a prescription of zero, which is "none planned" rather than a target', async () => {
    await session(3, [[0, 60], [90, 95]])

    const data = await get()

    expect(data.restSets).toEqual([{ plannedRestSec: 90, restTimeSec: 95 }])
  })

  // Zero rest TAKEN is a real measurement — the set that ran straight into the next one. Discarding
  // it would quietly bias the mean upward, which is the opposite of what the card reports.
  it('keeps zero rest taken, which is a measurement rather than a gap', async () => {
    await session(3, [[90, 0]])

    const data = await get()

    expect(data.restSets).toEqual([{ plannedRestSec: 90, restTimeSec: 0 }])
  })

  // The card reads the snapshot precisely so a later style edit cannot rewrite the past. If these
  // pairs ever came from the live style, this session — which has no style at all — would still
  // produce them, or would produce today's numbers instead of the logged ones.
  it('reads the logged snapshot, not the current progression style', async () => {
    await session(3, [[90, 105]])
    // A style edit after the fact must not move a logged pair.
    await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Edited After') ON CONFLICT DO NOTHING`,
      [TEST_USER_ID],
    )

    const data = await get()

    expect(data.restSets).toEqual([{ plannedRestSec: 90, restTimeSec: 105 }])
  })
})

// #2234 (TN-53): the 14-day HR-recovery trend plotted 0-value points on days the ring was the only
// heart-rate source. Nothing coerced a null to 0 — the route re-derived each set's recovery with the
// nearest-reading rule (`analyseHrRecovery`), and two ring readings ~60 s apart at the same bpm pass
// its 45–75 s separation gate and difference to exactly 0. The trend now reads HRR60 (`deriveHrr60`,
// the owner-signed dense rule of #2299 v2), so a ring-only day is ABSENT (null, a gap in the line)
// and a strap day keeps its measured value.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000c2234'
const TZ = 'Australia/Brisbane'
const ids = (n: number) => `00000000-0000-4000-8000-0000000c22${String(40 + n).padStart(2, '0')}`

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))

describe.skipIf(!canRun)('health/trends — HR recovery: absence is null, never 0 (#2234)', () => {
  let pool: import('pg').Pool
  let dStrap: string, dRingFlat: string, dRingRising: string, dNoHr: string, dNoSession: string

  // Local midday N days back (02:00 UTC = 12:00 Brisbane), so no fixture straddles a date boundary.
  const middayDaysAgo = (n: number) => {
    const d = new Date(Date.now() - n * 86_400_000)
    d.setUTCHours(2, 0, 0, 0)
    return d
  }

  const cleanup = async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { toAestDay } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, `hrr-trend-${USER}@example.com`, TZ])
    await cleanup()

    const strapEnd = middayDaysAgo(2)
    const ringFlatEnd = middayDaysAgo(3)
    const ringRisingEnd = middayDaysAgo(4)
    const noHrEnd = middayDaysAgo(5)
    dStrap = toAestDay(strapEnd, TZ)
    dRingFlat = toAestDay(ringFlatEnd, TZ)
    dRingRising = toAestDay(ringRisingEnd, TZ)
    dNoHr = toAestDay(noHrEnd, TZ)
    dNoSession = toAestDay(middayDaysAgo(6), TZ)

    const sessions: [number, Date][] = [[1, strapEnd], [2, ringFlatEnd], [3, ringRisingEnd], [4, noHrEnd]]
    for (const [n, end] of sessions) {
      const ws = ids(n), el = ids(n + 10), sl = ids(n + 20)
      await pool.query(
        `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at, phase_type)
         VALUES ($1, $2, 'Push', $3, $4, 'peak')`,
        [ws, USER, new Date(end.getTime() - 600_000), new Date(end.getTime() + 300_000)])
      await pool.query(
        `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1, $2, 'Bench', $3)`,
        [el, ws, end])
      await pool.query(
        `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, set_start_ms, set_end_ms)
         VALUES ($1, $2, 1, 100, 5, $3, $4)`,
        [sl, el, end.getTime() - 40_000, end.getTime()])
    }

    const values: string[] = []
    const params: unknown[] = []
    const add = (at: Date, bpm: number, source: string) => {
      params.push(USER, at, bpm, source)
      values.push(`($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length})`)
    }
    // Strap at 1 Hz over the minute after the set: 150 → 130, a measured 20 bpm recovery.
    for (let k = 0; k <= 60; k++) add(new Date(strapEnd.getTime() + k * 1000), 150 - Math.round(k / 3), 'chest_strap')
    // Ring, power-gated and idle: one reading at the set end and one 60 s later, same bpm. The
    // nearest-reading rule differences these to a "recovery" of exactly 0.
    add(ringFlatEnd, 92, 'ble')
    add(new Date(ringFlatEnd.getTime() + 60_000), 92, 'ble')
    // Ring again, heart rate a touch higher a minute later — the nearest-reading rule reports −3.
    add(ringRisingEnd, 95, 'ble')
    add(new Date(ringRisingEnd.getTime() + 60_000), 98, 'ble')
    await pool.query(`INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${values.join(', ')}`, params)
  })

  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('plots a strap day, and leaves ring-only and unmeasured days as gaps rather than zeros', async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const { trends } = await res.json() as { trends: { date: string; hrr1Bpm: number | null }[] }
    const hrr = new Map(trends.map(t => [t.date, t.hrr1Bpm]))

    expect(hrr.get(dStrap)).toBe(20)
    // The two defects: a flat ring pair was a 0 point, a rising one a negative point.
    expect(hrr.get(dRingFlat)).toBeNull()
    expect(hrr.get(dRingRising)).toBeNull()
    // Real gaps stay gaps: a session with no HR at all, and a day with no session.
    expect(hrr.get(dNoHr)).toBeNull()
    expect(hrr.get(dNoSession)).toBeNull()
    // Every day is a number or null — never undefined (which JSON drops) and never a coerced 0.
    for (const t of trends) expect(t.hrr1Bpm === null || typeof t.hrr1Bpm === 'number').toBe(true)
    expect(trends.filter(t => t.hrr1Bpm === 0)).toEqual([])
  })
})

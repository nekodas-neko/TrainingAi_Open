// BF-59 — a full week of correct training read as a volume deficit.
//
// The owner: *"i did the full sessions for the week; and i was nowhere near hitting the reccomended
// amount of muscle sets"*, then the cause, in their own words: *"oh yes cause its realization phase
// its been less sets."*
//
// **The formula-level test cannot catch what this one does.** `weeklyVolumeTarget` being right is
// worth nothing while the route still reads `program_volume_targets.target_sets_per_week`, so the
// load-bearing case here stores a target that is deliberately absurd and asserts the response does
// not contain it. That is the only assertion that can tell "derived" from "read".
//
// The fixture is anchored on the user's local week from the clock — a hardcoded date is a time bomb.
// Runs only against a real local dev Postgres; skips cleanly in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000590'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('weekly volume targets are derived, and take the phase (BF-59)', () => {
  let pool: import('pg').Pool
  let GET: () => Promise<Response>
  let programId: string
  let sessionIds: string[]

  const call = async () => {
    const res = await GET()
    return await res.json() as {
      muscles: { muscle: string; sets: number; target?: number }[]
      phase?: { scale: number; dominant: string | null; counts: Record<string, number> }
    }
  }

  const targetFor = (body: Awaited<ReturnType<typeof call>>, muscle: string) =>
    body.muscles.find(m => m.muscle === muscle)?.target

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    GET = (await import('@/app/api/weekly-muscle-sets/route')).GET
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'bf59-weekly-volume@example.com', TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM session_periodization WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM session_periodization WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])

    // The owner's own program shape: powerbuilding (×0.8), ai_dynamic.
    const { rows: p } = await pool.query(
      `INSERT INTO programs (user_id, name, training_goal, phase_mode, is_active)
       VALUES ($1, 'BF-59 Fixture', 'powerbuilding', 'ai_dynamic', true) RETURNING id`, [USER])
    programId = p[0].id

    const { rows: ses } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position)
       VALUES ($1, 'A', 1), ($1, 'B', 2), ($1, 'C', 3) RETURNING id`, [programId])
    sessionIds = ses.map((r: { id: string }) => r.id)

    // The roster. The NUMBERS here are deliberately absurd — nothing may read them.
    await pool.query(
      `INSERT INTO program_volume_targets (program_id, muscle_group, target_sets_per_week)
       VALUES ($1, 'chest', 999), ($1, 'glutes', 999)`, [programId])
  })

  /** A workout on the user's local Monday, so it always lands inside the current week. */
  const logSession = async (programSessionId: string) => {
    const { fromZonedTime, toZonedTime } = await import('date-fns-tz')
    const nowZoned = toZonedTime(new Date(), TZ)
    const monday = new Date(nowZoned)
    monday.setDate(monday.getDate() - ((nowZoned.getDay() + 6) % 7))
    // Midday, not midnight: a boundary is where an off-by-one stops being visible.
    monday.setHours(12, 0, 0, 0)
    await pool.query(
      `INSERT INTO workout_sessions (user_id, program_session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'BF-59 fixture session', $3, $3)`,
      [USER, programSessionId, fromZonedTime(monday, TZ).toISOString()],
    )
  }

  const setPhase = (programSessionId: string, phase: string) => pool.query(
    `INSERT INTO session_periodization (user_id, program_session_id, phase)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, program_session_id) DO UPDATE SET phase = EXCLUDED.phase`,
    [USER, programSessionId, phase])

  // THE assertion. 999 is in the table; if it reaches the response the route is still reading it.
  it('never returns the stored number', async () => {
    const body = await call()
    expect(body.muscles.map(m => m.target)).not.toContain(999)
    expect(targetFor(body, 'chest')).toBeGreaterThan(0)
  })

  it('returns the goal-adjusted landmark when nothing has been trained yet', async () => {
    const { volumeLandmarks } = await import('@trainingai/shared/ai-periodization/volume-targets')
    const body = await call()
    expect(targetFor(body, 'chest')).toBe(volumeLandmarks('powerbuilding', 'chest').mav)
    expect(body.phase).toEqual({ scale: 1, dominant: null, counts: {} })
  })

  it('asks for less once the week is a peaking one, and says so', async () => {
    const before = await call()
    for (const id of sessionIds) await setPhase(id, 'realisation')
    for (const id of sessionIds) await logSession(id)

    const after = await call()
    expect(after.phase?.dominant).toBe('realisation')
    expect(after.phase?.counts).toEqual({ realisation: 3 })
    expect(after.phase!.scale).toBeLessThan(1)
    expect(targetFor(after, 'chest')!).toBeLessThan(targetFor(before, 'chest')!)
    expect(targetFor(after, 'glutes')!).toBeLessThan(targetFor(before, 'glutes')!)
  })

  // The production case: the owner's sessions span three phases at once, so a week has a MIX and
  // not a phase. A route that picked one would score this week as a full peak.
  it('averages a mixed week rather than taking one session\'s phase', async () => {
    await setPhase(sessionIds[0], 'realisation')
    await setPhase(sessionIds[1], 'accumulation')
    await setPhase(sessionIds[2], 'accumulation')
    for (const id of sessionIds) await logSession(id)

    const mixed = await call()
    expect(mixed.phase?.counts).toEqual({ realisation: 1, accumulation: 2 })
    expect(mixed.phase!.scale).toBeGreaterThan(0.6)
    expect(mixed.phase!.scale).toBeLessThan(1)
  })

  // Weighted by workout session, not by distinct program session: training one session twice in a
  // week is two sessions' worth of that phase's volume.
  it('counts a session trained twice as two sessions', async () => {
    await setPhase(sessionIds[0], 'realisation')
    await setPhase(sessionIds[1], 'accumulation')
    await logSession(sessionIds[0])
    await logSession(sessionIds[0])
    await logSession(sessionIds[1])

    const body = await call()
    expect(body.phase?.counts).toEqual({ realisation: 2, accumulation: 1 })
  })

  // A soft-deleted session is not training that happened.
  it('ignores a deleted workout session', async () => {
    await setPhase(sessionIds[0], 'realisation')
    await logSession(sessionIds[0])
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE user_id = $1`, [USER])

    const body = await call()
    expect(body.phase).toEqual({ scale: 1, dominant: null, counts: {} })
  })
})

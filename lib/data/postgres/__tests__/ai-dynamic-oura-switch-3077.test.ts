// #3077 — ai_dynamic's temperature alert and daytime stress across the switch to the Oura API.
//
// Both read only the ring's rollup: the alert's deviation and baseline length from
// `oura_daily_summary` (its baseline read 0 nights after the switch, so the alert could never fire),
// and stress from `oura_daily_derived`. The alert now reads readiness v8's per-device temperature
// with that device's own baseline length and centring; stress takes the ring's value only before
// the switch day and Oura's `stress_high` for a day the ring has none, as the coach does.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const scorerInputs: Record<string, unknown>[] = []
vi.mock('@trainingai/shared/ai-periodization/ai-dynamic', async (importActual) => {
  const actual = await importActual<typeof import('@trainingai/shared/ai-periodization/ai-dynamic')>()
  return {
    ...actual,
    computeAiDynamicNextSession: (input: Parameters<typeof actual.computeAiDynamicNextSession>[0]) => {
      scorerInputs.push(input as unknown as Record<string, unknown>)
      return actual.computeAiDynamicNextSession(input)
    },
  }
})

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003077'
const TZ = 'Australia/Brisbane'
const CENTRED = [0.1, -0.1, 0.05, -0.08, 0.02, -0.04, 0.09, -0.11, 0.03, -0.02, 0.06, -0.07]

describe.skipIf(!canRun)('ai_dynamic temperature and stress follow the switch day (#3077)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let today: string
  let day: (offset: number) => string

  const tables = ['oura_daily_summary', 'oura_daily', 'oura_daily_derived', 'body_metrics'] as const
  async function clear() {
    for (const t of tables) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
  }
  function setSwitchDay(d: string | null) {
    vi.spyOn(repo, 'getOuraCloudSwitchDay').mockResolvedValue(d)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    repo = await getRepository()
    today = todayInTz(TZ)
    day = (offset: number) => shiftDateStr(today, offset)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'ai-dynamic-oura-switch@example.com', TZ],
    )
    await cleanupProgram()
    const { rows: [prog] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode, started_at, sessions_per_cycle)
       VALUES ($1, 'AI Program', true, 'ai_dynamic', NOW(), 1) RETURNING id`,
      [USER],
    )
    const { rows: [sess] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position, icon) VALUES ($1, 'Lower', 0, 'Dumbbell') RETURNING id`,
      [prog.id],
    )
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES ($1, 'Barbell Squat', ARRAY['quads'], 0)`,
      [sess.id],
    )
  })

  async function cleanupProgram() {
    await pool.query(
      `DELETE FROM session_exercises WHERE session_id IN (
         SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = $1)`,
      [USER],
    )
    await pool.query(`DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = $1)`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
  }

  beforeEach(async () => {
    scorerInputs.length = 0
    vi.restoreAllMocks()
    await clear()
    // Leftover ring stress for today, and Oura's own for the same day.
    await pool.query(`INSERT INTO oura_daily_derived (user_id, day, stress_high_minutes) VALUES ($1, $2, 45)`, [USER, today])
  })

  afterAll(async () => {
    await clear()
    await cleanupProgram()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  /** Ring nights ending today, newest last; today's deviation is `tonight`. */
  async function seedRing(deviations: number[], tonight: number, nHistory = 34) {
    const all = [...deviations, tonight]
    for (let i = 0; i < all.length; i++) {
      await pool.query(
        `INSERT INTO oura_daily_summary (user_id, date, temp_dev_c, n_history) VALUES ($1, $2, $3, $4)`,
        [USER, day(-(all.length - 1 - i)), all[i], nHistory],
      )
    }
  }
  /** Oura nights ending today, newest last, plus today's stress and an HRV so tonight is today. */
  async function seedOura(deviations: number[], tonight: number) {
    const all = [...deviations, tonight]
    for (let i = 0; i < all.length; i++) {
      const date = day(-(all.length - 1 - i))
      await pool.query(
        `INSERT INTO oura_daily (user_id, date, temperature_deviation, stress_high) VALUES ($1, $2, $3, $4)`,
        [USER, date, all[i], date === today ? 3_600 : null],
      )
    }
    await pool.query(`INSERT INTO body_metrics (user_id, date, hrv_ms) VALUES ($1, $2, 50)`, [USER, today])
  }
  const lastScorerInput = () => scorerInputs.at(-1)!

  /**
   * The ring's leftover row for today, after the switch: its own history is long and centred, but it
   * carries no temperature tonight. `main` read this row's `nHistory` and centring for Oura's value.
   */
  async function seedRingLeftoverToday() {
    await seedRing(CENTRED, 0.0)
    await pool.query(`UPDATE oura_daily_summary SET temp_dev_c = NULL WHERE user_id = $1 AND date = $2`, [USER, today])
  }

  it("before the switch day, the ring's temperature is unchanged", async () => {
    setSwitchDay(day(1))
    await seedRing(CENTRED, 0.519)
    await seedOura(Array.from({ length: 35 }, (_, i) => (i % 2 ? 0.1 : -0.1)), 0.9)
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.519, 5)
    expect(next?.signals?.temperatureBaselineDays).toBe(34)
    expect(next?.signals?.temperatureTrusted).toBe(true)
    expect(next?.temperatureAlert).toBe(true)
  })

  it("after the switch, an Oura-only night raises the alert on Oura's own baseline", async () => {
    setSwitchDay(day(-3))
    await seedOura(Array.from({ length: 35 }, (_, i) => (i % 2 ? 0.1 : -0.1)), 0.6)
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.6, 5)
    expect(next?.signals?.temperatureBaselineDays).toBe(35)
    expect(next?.signals?.temperatureTrusted).toBe(true)
    expect(next?.temperatureAlert).toBe(true)
    expect(next?.deloadOrRestRecommended).toBe(true)
  })

  // The ring's month of centred history must not mature or centre a young Oura normal. On `main`
  // this raised the alert: Oura's 0.6 was judged with the ring row's 34 nights and its centring.
  it("after the switch, a young Oura baseline holds the alert back, whatever the ring's history", async () => {
    setSwitchDay(day(-3))
    await seedRingLeftoverToday()
    await seedOura(CENTRED, 0.6)
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.temperatureAlert).toBe(false)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.6, 5)
    expect(next?.signals?.temperatureBaselineDays).toBe(CENTRED.length)
  })

  // Same shape, mature but uncentred Oura nights: `main` judged centring on the ring's rows and alerted.
  it('after the switch, an uncentred Oura baseline suspends the alert (TN-18), whatever the ring\'s centring', async () => {
    setSwitchDay(day(-3))
    await seedRingLeftoverToday()
    await seedOura(Array.from({ length: 35 }, () => 0.45), 0.6)
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.temperatureAlert).toBe(false)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.6, 5)
    expect(next?.signals?.temperatureTrusted).toBe(false)
  })

  // Mixed devices with no ring row tonight: ring nights earlier in the window never count toward
  // Oura's baseline length.
  it("ring history plus a young Oura night tonight counts only Oura's nights", async () => {
    setSwitchDay(day(-3))
    for (let i = 1; i <= 20; i++) {
      await pool.query(
        `INSERT INTO oura_daily_summary (user_id, date, temp_dev_c, n_history) VALUES ($1, $2, $3, 34)`,
        [USER, day(-3 - i), i % 2 ? 0.1 : -0.1],
      )
    }
    await seedOura([0.05, -0.05, 0.02], 0.6)
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.6, 5)
    expect(next?.signals?.temperatureBaselineDays).toBe(3)
    expect(next?.temperatureAlert).toBe(false)
  })

  it("stress: before the switch day the ring's minutes stand", async () => {
    setSwitchDay(day(1))
    await seedOura([0], 0)
    await repo.getNextSession(USER, TZ)
    expect(lastScorerInput().stressHighMinutes).toBe(45)
  })

  it("stress: from the switch day Oura's stress_high replaces the ring's leftover", async () => {
    setSwitchDay(day(-3))
    await seedOura([0], 0)
    await repo.getNextSession(USER, TZ)
    expect(lastScorerInput().stressHighMinutes).toBe(60)
  })
})

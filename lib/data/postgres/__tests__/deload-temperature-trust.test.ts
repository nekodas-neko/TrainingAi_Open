// TN-18 — TN-6a suspended the temperature ladder in readiness and its own entry said the suspension
// "must cover all three consumers". It covered one, and it was the path the owner does not read.
// The deload banner — the surface behind *"its often triggering deload days. its not trustable
// yet."* — kept firing off the same broken baseline.
//
// The unit tests pin `computeDeloadStrength`'s new condition. This pins the half they cannot see:
// that the adapter WIDENS its summary read far enough to judge centredness at all, and passes the
// answer through. With a today-only window there is nothing to compute the condition from, and the
// alert would fire exactly as before while every unit test stayed green.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000tn18'.replace('tn18', '0018')
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('the deload banner honours the temperature suspension (TN-18)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let today: string

  /** `n` nights of deviation ending today, newest last. */
  async function seedSummaries(deviations: number[], nHistory = 34) {
    const { shiftDateStr } = await import('@trainingai/shared/date-utils')
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
    for (let i = 0; i < deviations.length; i++) {
      const date = shiftDateStr(today, -(deviations.length - 1 - i))
      await pool.query(
        `INSERT INTO oura_daily_summary (user_id, date, temp_dev_c, n_history) VALUES ($1, $2, $3, $4)`,
        [USER, date, deviations[i], nHistory],
      )
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    repo = await getRepository()
    today = todayInTz(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'deload-temp-trust@example.com', TZ],
    )
    await cleanupProgram()
    // `signals` is only emitted by the ai_dynamic branch, so the program has to be one — a user
    // with no program returns a recommendation with nothing to inspect.
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
    await pool.query(
      `DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = $1)`,
      [USER],
    )
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
  }

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
    await cleanupProgram()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function signals() {
    const next = await repo.getNextSession(USER, TZ)
    return next?.signals
  }
  async function trusted(): Promise<boolean | undefined> {
    return (await signals())?.temperatureTrusted
  }

  // The owner's real shape: BF-13's zero-seeded baseline made the deviation positive on every
  // night, so a mean nowhere near zero. That is the state the suspension exists for.
  it('reports NOT trusted when every night sits above the baseline', async () => {
    await seedSummaries(Array.from({ length: 14 }, (_, i) => 0.45 + i * 0.01))
    expect(await trusted()).toBe(false)
  })

  // Self-clearing on purpose (TN-6a): once a re-derivation centres the stored deviations this
  // returns true with no deploy. Pinning it stops a future change quietly making the suspension
  // permanent, which would be a silent loss of the signal rather than a visible one.
  it('reports trusted once the deviations are centred on zero', async () => {
    await seedSummaries([0.1, -0.1, 0.05, -0.08, 0.02, -0.04, 0.09, -0.11, 0.03, -0.02, 0.06, -0.07])
    expect(await trusted()).toBe(true)
  })

  // Ten nights is the floor: below it there is no evidence the baseline is centred, and absence of
  // evidence is not evidence of centredness.
  it('reports NOT trusted on too few nights, however centred they look', async () => {
    await seedSummaries([0.01, -0.01, 0.0, 0.02, -0.02])
    expect(await trusted()).toBe(false)
  })

  // THE point of the entry, and the case the first version of this file missed: it asserted the
  // trust FLAG and never the alert, so the adapter simply not passing the flag into the engine
  // passed every test. `temperatureTrusted` reaching the signals block and `temperatureTrusted`
  // reaching the recommendation are two different wires.
  it('raises NO temperature alert on an over-threshold night while the baseline is uncentred', async () => {
    await seedSummaries(Array.from({ length: 14 }, () => 0.45), 34)
    await pool.query(
      `UPDATE oura_daily_summary SET temp_dev_c = 0.519 WHERE user_id = $1 AND date = $2`,
      [USER, today],
    )
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.signals?.temperatureTrusted).toBe(false)
    expect(next?.signals?.temperatureDeviation).toBeCloseTo(0.519, 5)   // over TEMP_ALERT_THRESHOLD_C
    expect(next?.temperatureAlert).toBe(false)
    expect(next?.deloadOrRestRecommended).toBe(false)
  })

  // The control, and it is not optional: a suppression that also suppresses the centred case is
  // not a fix, it is a mute. Same deviation, same maturity — only the baseline's centredness
  // differs, and the alert comes back.
  it('and DOES raise it on the same night once the baseline is centred', async () => {
    await seedSummaries([0.1, -0.1, 0.05, -0.08, 0.02, -0.04, 0.09, -0.11, 0.03, -0.02, 0.06, -0.07], 34)
    await pool.query(
      `UPDATE oura_daily_summary SET temp_dev_c = 0.519 WHERE user_id = $1 AND date = $2`,
      [USER, today],
    )
    const next = await repo.getNextSession(USER, TZ)
    expect(next?.signals?.temperatureTrusted).toBe(true)
    expect(next?.temperatureAlert).toBe(true)
    expect(next?.deloadOrRestRecommended).toBe(true)
  })

  // Widening the window introduced a way to get this wrong that did not exist before, and the
  // first version of this file did not catch it: `summaryRows[0]` used to BE today, and after the
  // widening it is the OLDEST of 28 nights. A month-stale deviation and baseline count feeding a
  // deload banner is a worse bug than the one being fixed, and every other test here passed with
  // it in place — the trust verdict comes from the whole window either way.
  it('still reads TODAY for the deviation and the baseline count, not the oldest night', async () => {
    const { shiftDateStr } = await import('@trainingai/shared/date-utils')
    await seedSummaries([0.1, -0.1, 0.05, -0.08, 0.02, -0.04, 0.09, -0.11, 0.03, -0.02, 0.06, -0.07])
    await pool.query(
      `UPDATE oura_daily_summary SET temp_dev_c = 0.9, n_history = 41 WHERE user_id = $1 AND date = $2`,
      [USER, today],
    )
    await pool.query(
      `UPDATE oura_daily_summary SET temp_dev_c = 0.1, n_history = 3 WHERE user_id = $1 AND date = $2`,
      [USER, shiftDateStr(today, -11)],
    )
    const s = await signals()
    expect(s?.temperatureDeviation).toBeCloseTo(0.9, 5)
    expect(s?.temperatureBaselineDays).toBe(41)
  })

  // The failure this test exists for. `getOuraDailySummary(today, today)` returns one row, and one
  // row is below the ten-night floor — so a regression that narrows the window back does not fail
  // loudly, it silently suspends the alert forever. Asserting the TRUSTED case above is what
  // catches that; this asserts the window is genuinely wide by putting the centred evidence
  // entirely in the PAST.
  it('reads the trailing window, not just today', async () => {
    const { shiftDateStr } = await import('@trainingai/shared/date-utils')
    await seedSummaries([0.1, -0.1, 0.05, -0.08, 0.02, -0.04, 0.09, -0.11, 0.03, -0.02, 0.06, -0.07])
    // Today's own row says nothing centred at all; the verdict must still come from the window.
    await pool.query(`UPDATE oura_daily_summary SET temp_dev_c = 0.02 WHERE user_id = $1 AND date = $2`,
      [USER, shiftDateStr(today, 0)])
    expect(await trusted()).toBe(true)
  })
})

// Calories in vs calories out, and the calibrated-maintenance estimate behind it.
//
// The invariant this file exists for: the CURRENT day must never enter the calibration window.
// A day in progress has only part of its food logged, so counting it drags the mean intake down
// and the estimate reports a lower maintenance every morning that recovers each evening — the
// same partial-day trap as the Oura `wornHours` mistake. It was live until measured.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000051e0'
const TZ = 'Australia/Brisbane'
// Fixed, and both sides of every comparison derive from it — never one side on the real clock.
const TODAY = '2026-06-15'

describe.skipIf(!canRun)('energy balance — calibration window', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let computeEnergyBalance: typeof import('@/lib/health/energy-balance-service').computeEnergyBalance
  let mealTypeId: string
  let foodItemId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    ;({ computeEnergyBalance } = await import('@/lib/health/energy-balance-service'))
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, date_of_birth, sex, height_cm, fitness_goal)
       VALUES ($1, $2, 'x', $3, '1993-01-01', 'male', 175, 'lose_weight')
       ON CONFLICT (id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth, sex = EXCLUDED.sex,
         height_cm = EXCLUDED.height_cm, fitness_goal = EXCLUDED.fitness_goal`,
      [TEST_USER_ID, `energy-balance-${TEST_USER_ID}@example.com`, TZ],
    )
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Test Meal', 0) RETURNING id`,
      [TEST_USER_ID],
    )
    mealTypeId = mt.rows[0].id
    // 100 kcal per serving, so a quantity multiplier reads directly as hundreds of kcal.
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'Test Food', 100, 100, 10, 10, 2, 'manual') RETURNING id`,
      [TEST_USER_ID],
    )
    foodItemId = fi.rows[0].id
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  /** Log `kcal` on `date` (item is 100 kcal/serving). */
  async function logFood(date: string, kcal: number) {
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
       VALUES ($1, $2::date, $3, $4, $5, $2::date + interval '12 hours')`,
      [TEST_USER_ID, date, mealTypeId, foodItemId, kcal / 100],
    )
  }

  /** 28 completed days ending yesterday: 2000 kcal/day, weight falling 1 kg linearly. */
  async function seedCalibratableHistory() {
    const start = shiftDateStr(TODAY, -28)
    for (let i = 0; i < 28; i++) {
      const d = shiftDateStr(start, i)
      await logFood(d, 2000)
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, steps) VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, steps = 0`,
        [TEST_USER_ID, d, 80 - (1 * i) / 27],
      )
    }
  }

  it('calibrates maintenance above intake when weight is falling', async () => {
    await seedCalibratableHistory()
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance?.source).toBe('calibrated')
    // Ate 2000/day while losing ~1 kg over the window — real burn exceeds intake.
    expect(r.maintenance!.kcal).toBeGreaterThan(2000)
    expect(r.maintenance!.weightRateKgPerWeek).toBeLessThan(0)
  })

  it('does NOT move the maintenance estimate as the current day is logged', async () => {
    await seedCalibratableHistory()
    const before = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    // A partial day: only breakfast so far.
    await logFood(TODAY, 400)
    const afterBreakfast = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    await logFood(TODAY, 1200)
    const afterDinner = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    expect(afterBreakfast.maintenance!.kcal).toBe(before.maintenance!.kcal)
    expect(afterDinner.maintenance!.kcal).toBe(before.maintenance!.kcal)
    // The balance itself must still track the day's logging.
    expect(afterBreakfast.balance!.intakeKcal).toBe(400)
    expect(afterDinner.balance!.intakeKcal).toBe(1600)
  })

  it('counts only completed days toward the calibration window', async () => {
    await seedCalibratableHistory()
    await logFood(TODAY, 400)
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance!.daysInWindow).toBe(28)
    // 28 seeded completed days, all logged — today is excluded, so it cannot be 29.
    expect(r.maintenance!.daysLogged).toBe(28)
  })

  it('falls back to the formula baseline with a reason when nothing is logged', async () => {
    // A weight is still needed for a BMR at all — this is the "weighs in, has not logged food"
    // case, which is exactly where the owner starts.
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2::date, 80)`,
      [TEST_USER_ID, TODAY],
    )
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance?.source).toBe('formula')
    expect(r.maintenance?.gapMessage).toBeTruthy()
    expect(r.maintenance!.kcal).toBeGreaterThan(1200)
  })

  it('bands the day against the goal deficit, not against zero', async () => {
    await seedCalibratableHistory()
    const r0 = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    // lose_weight asks for −500 kcal/day.
    expect(r0.balance!.targetNetKcal).toBe(-500)

    // Eat exactly maintenance: net 0, which is 500 kcal ABOVE what the goal calls for.
    await logFood(TODAY, r0.balance!.expenditureKcal)
    const rMaint = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(rMaint.balance!.netKcal).toBe(0)
    expect(rMaint.balance!.zone).toBe('far_over')
  })

  it('reports the goal-aware recommended target from calibrated maintenance', async () => {
    await seedCalibratableHistory()
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.target.recommendedKcal).toBe(r.maintenance!.kcal - 500)
  })

  it('scopes every read to the user', async () => {
    await seedCalibratableHistory()
    const otherUser = '00000000-0000-4000-8000-0000000051e1'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [otherUser, `other-${otherUser}@example.com`, TZ],
    )
    const r = await computeEnergyBalance(repo, otherUser, TZ, TODAY)
    // No profile, no logs — the other user's 28 days must not leak in.
    expect(r.balance).toBeNull()
    expect(r.missingProfileFields.length).toBeGreaterThan(0)
    await pool.query(`DELETE FROM users WHERE id = $1`, [otherUser])
  })
})

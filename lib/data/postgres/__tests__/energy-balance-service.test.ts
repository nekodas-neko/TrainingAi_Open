// Calories in vs calories out, and the calibrated-maintenance estimate behind it.
//
// The invariant this file exists for: the CURRENT day must never enter the calibration window.
// A day in progress has only part of its food logged, so counting it drags the mean intake down
// and the estimate reports a lower maintenance every morning that recovers each evening — the
// same partial-day trap as the Oura `wornHours` mistake. It was live until measured.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { shiftDateStr, ageFromDob } from '@trainingai/shared/date-utils'
import { mifflinStJeorBmr } from '@trainingai/shared/nutrition/goal-recommendation'
import { SEDENTARY_MULTIPLIER } from '@trainingai/shared/health/energy-baseline'

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
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [TEST_USER_ID])
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

  /** Mark a day's food log finished (Q-387) — only marked days may enter the calibration. */
  async function markLoggingComplete(date: string) {
    await pool.query(
      `INSERT INTO day_checkins (user_id, log_date, phase, food_logging_completed_at)
       VALUES ($1, $2::date, 'evening', now())
       ON CONFLICT (user_id, log_date, phase) DO UPDATE SET food_logging_completed_at = now()`,
      [TEST_USER_ID, date],
    )
  }

  /** 28 completed days ending yesterday: 2000 kcal/day, weight falling 1 kg linearly.
   *
   *  Q-387: every day is also MARKED complete. Before that flag existed, "logged" meant any non-zero
   *  intake, so a day abandoned after lunch counted at its partial total and dragged the mean down
   *  86 kcal per partial day with nothing flagged. Marking is now what makes a day usable, and this
   *  helper marks them because the scenario it describes is a fully-logged history. */
  async function seedCalibratableHistory() {
    const start = shiftDateStr(TODAY, -28)
    for (let i = 0; i < 28; i++) {
      const d = shiftDateStr(start, i)
      await logFood(d, 2000)
      await markLoggingComplete(d)
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

  // Q-387, driven through the whole service rather than the shared module: an unmarked history is
  // not a calibration input, however much food it contains. This is the end-to-end proof that the
  // flag reaches `estimateMaintenance` — the day key is a plain 'YYYY-MM-DD' string on both sides,
  // and a mismatch there would silently exclude everything and look exactly like correct behaviour.
  it('falls back to formula when the days are logged but never marked complete (Q-387)', async () => {
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

    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    expect(r.maintenance?.source).toBe('formula')
  })

  it('calibrates once those same days ARE marked complete', async () => {
    await seedCalibratableHistory()
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance?.source).toBe('calibrated')
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

  /**
   * Q-527 — a scale misread must not inflate the energy budget.
   *
   * This service used to derive lean mass with its own inline `weight × (1 − bf/100)` and feed it
   * to Cunningham, bypassing the body-fat plausibility band that lives in `bodyComposition`. A
   * no-contact weigh-in floors the scale's estimate at 3% (impedance 0 — see
   * `lib/scale-ble/composition.ts`), which puts lean mass at 97% of bodyweight and raises the
   * formula baseline by roughly a quarter, on the number the owner is told they may eat.
   *
   * Asserted as an equality against the no-reading case rather than a threshold: the point is that
   * an implausible reading takes the *same* branch as no reading at all.
   */
  it('ignores an implausible body-fat reading rather than inflating the baseline (Q-527)', async () => {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2::date, 72.55)`,
      [TEST_USER_ID, TODAY],
    )
    const withoutReading = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    await pool.query(
      `UPDATE body_metrics SET body_fat_pct = 3 WHERE user_id = $1 AND date = $2::date`,
      [TEST_USER_ID, TODAY],
    )
    const withMisread = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    expect(withMisread.maintenance?.kcal).toBe(withoutReading.maintenance?.kcal)

    // And a real reading still moves it — otherwise this would pass with the body-fat branch
    // deleted outright rather than guarded.
    await pool.query(
      `UPDATE body_metrics SET body_fat_pct = 24 WHERE user_id = $1 AND date = $2::date`,
      [TEST_USER_ID, TODAY],
    )
    const withRealReading = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(withRealReading.maintenance?.kcal).not.toBe(withoutReading.maintenance?.kcal)
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

  /**
   * BF-88 — the shift conserves. This is the test the entry asked for by name.
   *
   * Steps used to count only above 3,000 against a `BMR × 1.2` base; they now count from the first
   * step and the same 3,000 steps' energy is credited out of that base. **At exactly
   * `STEP_BASE_CREDIT` the two are equal, so the day's total burn must be identical to what it was
   * before** — that equality is what makes this a reparameterisation rather than a re-scoring, and
   * measuring it in the service is the only place both halves are visible together.
   *
   * Asserted as `restingBase + active === BMR × 1.2 + 0` rather than against a recorded number,
   * because a pinned figure would go stale the moment any other input to the base moves.
   */
  async function setSteps(date: string, steps: number) {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, steps) VALUES ($1, $2, 80, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET steps = EXCLUDED.steps, weight_kg = 80`,
      [TEST_USER_ID, date, steps],
    )
  }

  it('a day at exactly the credit burns what it burned before the shift', async () => {
    const { STEP_BASE_CREDIT } = await import('@trainingai/shared/health/daily-energy')
    await setSteps(TODAY, STEP_BASE_CREDIT)
    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance.source, 'this case is about the FORMULA path').toBe('formula')

    // What the old model produced for this day: the full base, and nothing earned from stepping.
    const burnBefore = r.maintenance.kcal
    const burnNow = r.balance.restingBaseKcal + r.balance.activeKcal
    expect(Math.abs(burnNow - burnBefore), `${burnNow} vs ${burnBefore}`).toBeLessThanOrEqual(1)

    // And the split moved, which is the visible change: the base is lower and movement is not zero.
    expect(r.balance.restingBaseKcal).toBeLessThan(burnBefore)
    expect(r.balance.activeKcal).toBeGreaterThan(0)

    // **The assertion that pins WHICH number took the credit.** `formulaBaseline` is both the
    // resting base and the uncalibrated maintenance estimate, and only the base may take the credit.
    //
    // Every relative check fails to see the difference, which is why this one is absolute. Measured
    // by mutation: subtracting the credit inside `formulaBaseline` — so maintenance drops too and
    // the base drops twice — keeps `maintenance − restingBase === activeKcal` exactly true, keeps
    // burn equal to maintenance, and still cuts the user's recommended intake by ~100 kcal every
    // day. Only an anchor the mutation cannot move catches it, so this recomputes the expected
    // maintenance from the same inputs with the same function rather than pinning a figure that
    // would go stale.
    const expectedBmr = mifflinStJeorBmr(80, 175, ageFromDob('1993-01-01', new Date())!, 'male')
    expect(r.maintenance.kcal, 'maintenance must stay at BMR × the sedentary multiplier')
      .toBe(Math.round(expectedBmr * SEDENTARY_MULTIPLIER))
    expect(r.balance.restingBaseKcal, 'the base takes the credit exactly once')
      .toBe(Math.round(expectedBmr * SEDENTARY_MULTIPLIER) - r.balance.activeKcal)
  })

  it('a day below the credit burns less, and a day above burns the same as before', async () => {
    const { STEP_BASE_CREDIT } = await import('@trainingai/shared/health/daily-energy')
    await setSteps(TODAY, 0)
    const none = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    const burnNone = none.balance.restingBaseKcal + none.balance.activeKcal
    // The intent of the whole entry: a day with no walking is no longer paid for incidental
    // walking that did not happen.
    expect(burnNone).toBeLessThan(none.maintenance.kcal)

    await setSteps(TODAY, STEP_BASE_CREDIT + 7000)
    const many = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    const burnMany = many.balance.restingBaseKcal + many.balance.activeKcal
    // Above the credit it is a pure reparameterisation: the extra 7,000 steps are worth what they
    // were worth before, on top of an unchanged total at the crossover.
    expect(burnMany).toBeGreaterThan(burnNone)
  })

  /**
   * The calibrated path must NOT take the credit, and this is the half an implementer gets wrong.
   *
   * There the base is `maintenance − avgActiveKcal` and `maintenance` is measured, so lowering the
   * step floor raises `avgActiveKcal` and the subtraction already happens by itself. Applying the
   * credit as well double-subtracts it — the entry says so in as many words, and it still survived
   * every other test in this file until this one existed.
   *
   * `seedCalibratableHistory` gives every window day zero steps and no sessions, so `avgActiveKcal`
   * is 0 and the base must equal the maintenance figure exactly. A credit applied here shows up as
   * the gap between them.
   */
  it('does not credit the base again on the calibrated path', async () => {
    const { STEP_BASE_CREDIT } = await import('@trainingai/shared/health/daily-energy')
    await seedCalibratableHistory()
    await setSteps(TODAY, STEP_BASE_CREDIT)

    const r = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    expect(r.maintenance.source, 'this case is about the CALIBRATED path').toBe('calibrated')
    expect(r.balance.activeKcal, "today's steps should still earn from the first one").toBeGreaterThan(0)

    // avgActiveKcal is 0 across the window, so the base IS the maintenance figure. Any credit
    // applied here would open a gap of ~100 kcal.
    expect(r.balance.restingBaseKcal, 'the credit was applied on the calibrated path too')
      .toBe(Math.round(r.maintenance.kcal))
  })

  /**
   * The maintenance TARGET must not move. `formulaBaseline` is both the resting base and the
   * uncalibrated maintenance estimate, and only the first takes the credit — subtracting it from
   * maintenance too would quietly cut the user's recommended intake by ~100 kcal every day, which
   * is a different change from the one that was approved.
   */
  it('the recommended target is untouched by how many steps the day had', async () => {
    await setSteps(TODAY, 0)
    const none = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)
    await setSteps(TODAY, 14_000)
    const many = await computeEnergyBalance(repo, TEST_USER_ID, TZ, TODAY)

    expect(many.maintenance.kcal).toBe(none.maintenance.kcal)
    expect(many.recommendedKcal).toBe(none.recommendedKcal)
    // The base is the same on both days too — the credit is a property of the user, not the day.
    expect(many.balance.restingBaseKcal).toBe(none.balance.restingBaseKcal)
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

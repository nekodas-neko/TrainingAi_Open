// RV-177 — two routes that could be called without limit, one of them straight into a model.
//
// `nutrition/meal-plans/meals/[mealId]` PATCH runs `scaleWithTopUp`, a `generateObject` call, on the
// `scaleToTarget` branch, and had no limit while both its siblings capped at 10/h and 40/h.
// `log-calendar-event` writes to Google Calendar and read `startMs` straight out of an untyped cast
// into `new Date(...).toISOString()`, which throws RangeError — a client error as a server fault.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000177c01'

// `scaleWithTopUp` is a `generateObject` call. The limit fires BEFORE it, so the point of the case
// below is reached without a model — but the requests under the limit would still call one, which
// is what this stubs out. It is the module the route imports, not the ai-sdk beneath it.
vi.mock('@/lib/nutrition/meal-top-up', () => ({
  scaleWithTopUp: vi.fn(async (ingredients: unknown) => ingredients),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: USER, timezone: 'Australia/Brisbane' },
    refreshToken: 'fake-refresh-token',
  })),
}))

describe.skipIf(!canRun)('RV-177 — rate limits and a validated calendar body', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'rv177c@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    await resetLimits()
  })

  // Two cases below deliberately spend the hourly budget, and `rate_limits` is a SHARED Postgres
  // table — the count outlives the process. Without this the file passes once and then fails on
  // every re-run inside the hour, which is how it was first written.
  const resetLimits = async () => {
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1`, [`${USER}:%`])
  }

  afterAll(async () => {
    if (!canRun) return
    await resetLimits()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const postCalendar = async (body: unknown) => {
    const { POST } = await import('@/app/api/log-calendar-event/route')
    return POST(new Request('http://localhost/api/log-calendar-event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) as never)
  }

  const VALID = {
    sessionType: 'Upper',
    startMs: Date.UTC(2026, 8, 25, 9, 0),
    endMs: Date.UTC(2026, 8, 25, 10, 0),
    exercises: [{ name: 'Bench', setWeights: [60], reps: [8] }],
  }

  /**
   * The sharp case. `!startMs` passed every truthy value, so a string sailed into
   * `new Date(startMs).toISOString()` and threw. A 400 is the answer; a 500 with no body is not.
   */
  it.each([
    ['a string where a number belongs', { startMs: 'yesterday' }],
    ['a value past the Date range', { startMs: 1e20 }],
    ['a negative epoch', { startMs: -1 }],
    ['a fractional millisecond', { startMs: 1_700_000_000_000.5 }],
    ['an end before the start', { endMs: Date.UTC(2026, 8, 25, 8, 0) }],
    ['a missing sessionType', { sessionType: '' }],
  ])('log-calendar-event answers 400 for %s', async (_label, over) => {
    const res = await postCalendar({ ...VALID, ...over })
    expect(res.status).toBe(400)
  })

  /**
   * A long session must still reach the calendar. The first draft of the schema put `.max(50)` on
   * the exercise array, which turned a 60-exercise body into a 400 — the route has always
   * TRUNCATED into the description instead, and `feedback-calendar-scale-routes.test.ts` pins that.
   * The full suite caught it; this keeps the two properties together where the schema lives.
   */
  it('accepts more exercises than the description shows, rather than refusing the event', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Ex ${i}`, setWeights: [50], reps: [5] }))
    const res = await postCalendar({ ...VALID, exercises: many })
    expect(res.status).not.toBe(400)
  })

  it('log-calendar-event refuses an unknown key rather than ignoring it', async () => {
    const res = await postCalendar({ ...VALID, notAField: 1 })
    expect(res.status).toBe(400)
  })

  /**
   * The control that proves the cases above are about the BODY. A valid body gets past validation
   * and reaches the Google call, which fails on the fake refresh token — any status except 400 says
   * the body was accepted, which is the whole point.
   */
  it('a valid body passes validation and reaches the external call', async () => {
    const res = await postCalendar(VALID)
    expect(res.status).not.toBe(400)
  })

  it('the meal PATCH limits the scaleToTarget branch, which is the one that calls a model', async () => {
    const { rows: [plan] } = await pool.query(
      `INSERT INTO meal_plans (user_id, name, meals_per_day, target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, 'RV177 Plan', 3, 2000, 150, 200, 60) RETURNING id`, [USER])
    const { rows: [variant] } = await pool.query(
      `INSERT INTO meal_plan_variants (meal_plan_id, day_type, target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, 'all', 2000, 150, 200, 60) RETURNING id`, [plan.id])
    const { rows: [meal] } = await pool.query(
      `INSERT INTO meal_plan_meals (variant_id, position, name, target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, 0, 'Breakfast', 600, 40, 60, 20) RETURNING id`, [variant.id])

    const { PATCH } = await import('@/app/api/nutrition/meal-plans/meals/[mealId]/route')
    const patch = () => PATCH(
      new Request(`http://localhost/api/nutrition/meal-plans/meals/${meal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scaleToTarget: true,
          ingredients: [{ name: 'Oats', weightG: 80, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 67, fatPer100g: 7 }],
        }),
      }) as never,
      { params: Promise.resolve({ mealId: meal.id }) },
    )

    let saw429 = false
    for (let i = 0; i < 50 && !saw429; i++) {
      if ((await patch()).status === 429) saw429 = true
    }
    expect(saw429).toBe(true)

    await pool.query(`DELETE FROM meal_plans WHERE id = $1`, [plan.id])
  })

  it('log-calendar-event stops answering once the hourly limit is spent', async () => {
    // 30/h. The loop shares one key with the case above, so it is deliberately run last in the file
    // and asserts only that a 429 arrives, not on which iteration.
    let saw429 = false
    for (let i = 0; i < 40 && !saw429; i++) {
      if ((await postCalendar(VALID)).status === 429) saw429 = true
    }
    expect(saw429).toBe(true)
  })
})

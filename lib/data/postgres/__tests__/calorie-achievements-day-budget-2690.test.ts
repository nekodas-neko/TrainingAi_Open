// Issue 2690 (owner's decision on #2622). "Calorie Crusher" and "Macro Master" judged every day
// against `nutrition_targets.calories`, the old typed goal, while Nutrition and Home show the
// worked-out budget. Each day is now judged against the budget THAT day would have shown.
//
// The pinned cases:
//   · a day the typed target misses and its budget hits, and the reverse, where the only difference
//     is that day's movement;
//   · the past day's budget is the live energy balance's budget for that date, to the kcal — there is
//     no second budget formula;
//   · a user whose profile supports no budget keeps the typed-target judgement.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USERS = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-00000002690${i}`)

describe.skipIf(!canRun)('calorie achievements judge each day against that day\'s budget', () => {
  let pool: import('pg').Pool
  let ach: typeof import('@/lib/achievements')
  const day = shiftDateStr(todayInTz(TZ), -2)

  /** Male, 180 cm, born 1990, maintaining, weighing 80 kg on `day`, with a typed target of `typed`. */
  const seedUser = async (id: string, typed: number, profile = true) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, height_cm, date_of_birth, sex, fitness_goal)
       VALUES ($1,$2,'x',$3,$4,$5,$6,'maintain') ON CONFLICT (id) DO NOTHING`,
      [id, `ach-2690-${id.slice(-1)}@example.com`, TZ, profile ? 180 : null, profile ? '1990-01-01' : null, profile ? 'male' : null])
    await pool.query(`INSERT INTO nutrition_targets (user_id, calories) VALUES ($1,$2)`, [id, typed])
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1,$2,80)`, [id, day])
  }
  const eat = async (id: string, kcal: number) => {
    const mt = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1,'Lunch') RETURNING id`, [id])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1,'Test food',$2,'manual') RETURNING id`, [id, kcal])
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, logged_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, day, mt.rows[0].id, fi.rows[0].id, `${day}T02:00:00Z`]) // midday in Brisbane
  }
  const run = async (id: string, minutes: number) => {
    await pool.query(
      `INSERT INTO activity_logs (user_id, date, activity_type, title, duration_min) VALUES ($1,$2,'run','Run',$3)`,
      [id, day, minutes])
  }
  const crusher = async (id: string) =>
    (await ach.computeAchievements(id, TZ)).achievements.find(a => a.id === 'calorie_goal_7')?.current
  const budgetOn = async (id: string) => (await ach.pastDayCalorieBudgets(id, TZ, [day])).get(day)

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ach = await import('@/lib/achievements')
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS])
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS])
  })

  it('hits a day its budget says was on target although the typed goal says it was not', async () => {
    await seedUser(USERS[0], 3000)
    const budget = await budgetOn(USERS[0])
    expect(budget).toBeGreaterThan(1500)
    expect(budget).toBeLessThan(2500)
    // Eaten exactly the budget: within 10% of it, and 1,000 kcal under the typed 3,000.
    await eat(USERS[0], budget!)
    expect(await crusher(USERS[0])).toBe(1)
  })

  it('misses a day whose movement raised the budget, although the typed goal says it was a hit', async () => {
    await seedUser(USERS[1], 2000)
    await run(USERS[1], 90)
    const budget = await budgetOn(USERS[1])
    // Outside the 10% band around the day's budget, and inside it around the typed 2,000.
    expect(budget! - 2000).toBeGreaterThan(budget! * 0.1)
    await eat(USERS[1], 2000)
    expect(await crusher(USERS[1])).toBe(0)
  })

  it('is the energy balance\'s budget for that date, to the kcal', async () => {
    await seedUser(USERS[2], 2000)
    await run(USERS[2], 30)
    const { computeEnergyBalance } = await import('@/lib/health/energy-balance-service')
    const { getRepository } = await import('@/lib/data')
    const live = await computeEnergyBalance(await getRepository(), USERS[2], TZ, day)
    expect(live.balance?.budgetKcal).toBeGreaterThan(0)
    expect(await budgetOn(USERS[2])).toBe(live.balance?.budgetKcal)
  })

  it('keeps the typed-target judgement for a user whose profile supports no budget', async () => {
    await seedUser(USERS[3], 3000, false)
    expect(await budgetOn(USERS[3])).toBeNull()
    await eat(USERS[3], 2950)
    expect(await crusher(USERS[3])).toBe(1)
  })
})

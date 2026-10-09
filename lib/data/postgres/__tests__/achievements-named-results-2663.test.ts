// Issue 2663. `computeAchievements` ran its queries as a positional batch and destructured the
// results into names, and the last two names were in the opposite order to their queries: the
// schedule was read as the weight goal and the weight goal as the schedule. Nothing failed — a
// missing field is `undefined`, and every consumer had a fallback — so for as long as the file
// existed the calorie-goal achievements ignored whether the user was cutting or bulking, and the
// workout streak ignored the user's schedule.
//
// One test per family the swap touched, each written so it fails against the swapped order:
//   · calorie goals: a cutting day is a hit at or UNDER the target, a bulking day at or OVER it,
//     where the swapped code judged both as "within 10% of the target";
//   · the workout streak: a Mon+Tue schedule has a five-day hole every week that is not a missed
//     day, where the swapped code allowed two rest days;
//   · the current weight behind the goal direction ignores a deleted weigh-in (issue 2661), which
//     could not be tested while the swap hid its result.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USERS = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000263${i}`)

describe.skipIf(!canRun)('achievements read each result by the query that produced it', () => {
  let pool: import('pg').Pool
  let compute: typeof import('@/lib/achievements').computeAchievements
  const today = todayInTz(TZ)

  const seedUser = async (id: string, targetWeightKg: number | null) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, target_weight_kg)
       VALUES ($1,$2,'x',$3,$4) ON CONFLICT (id) DO UPDATE SET target_weight_kg = EXCLUDED.target_weight_kg`,
      [id, `ach-2663-${id.slice(-1)}@example.com`, TZ, targetWeightKg])
  }
  const progress = async (id: string, achievement: string) =>
    (await compute(id, TZ)).achievements.find(a => a.id === achievement)?.current

  /** A 2,000 kcal target, one food log of `kcal` today, and a weigh-in of `weightKg`. */
  const dayAt = async (id: string, kcal: number, weightKg: number, weighedOn = today) => {
    await pool.query(
      `INSERT INTO nutrition_targets (user_id, calories) VALUES ($1, 2000)
       ON CONFLICT (user_id) DO UPDATE SET calories = 2000`, [id])
    const mt = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1,'Lunch') RETURNING id`, [id])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1,'Test food',$2,'manual') RETURNING id`, [id, kcal])
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id) VALUES ($1,$2,$3,$4)`,
      [id, today, mt.rows[0].id, fi.rows[0].id])
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1,$2,$3)`, [id, weighedOn, weightKg])
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    compute = (await import('@/lib/achievements')).computeAchievements
    await seedUser(USERS[0], 70)   // cutting: 80 kg now, wants 70
    await seedUser(USERS[1], 70)   // cutting, over its target
    await seedUser(USERS[2], 90)   // bulking: 80 kg now, wants 90
    await seedUser(USERS[3], 90)   // bulking, under its target
    await seedUser(USERS[4], null) // the schedule family
    await seedUser(USERS[5], 70)   // current weight with a deleted newer weigh-in
    await seedUser(USERS[6], null)
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS])
  })

  describe('calorie goals follow the weight goal', () => {
    it('a cutting user under their target hits the goal', async () => {
      await dayAt(USERS[0], 1500, 80)
      expect(await progress(USERS[0], 'calorie_goal_7')).toBe(1)
    })
    it('a cutting user over their target does not', async () => {
      await dayAt(USERS[1], 2300, 80)
      expect(await progress(USERS[1], 'calorie_goal_7')).toBe(0)
    })
    it('a bulking user at or over their target hits the goal', async () => {
      await dayAt(USERS[2], 2300, 80)
      expect(await progress(USERS[2], 'calorie_goal_7')).toBe(1)
    })
    it('a bulking user under their target does not', async () => {
      await dayAt(USERS[3], 1500, 80)
      expect(await progress(USERS[3], 'calorie_goal_7')).toBe(0)
    })
  })

  it('the current weight behind that direction ignores a deleted weigh-in', async () => {
    // Target 70. The live weigh-in is 80 (cutting, so 1,500 kcal is a hit); the newer one, 60, is
    // deleted. Read as current it would flip the user to bulking, where 1,500 kcal is a miss.
    const id = USERS[5]
    await dayAt(id, 1500, 80, shiftDateStr(today, -2))
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg, deleted_at) VALUES ($1,$2,60,now())`, [id, today])
    expect(await progress(id, 'calorie_goal_7')).toBe(1)
  })

  it('the workout streak allows the rest days the user\'s own schedule has', async () => {
    // A Mon+Tue schedule trains two days a week and rests five, every week. Eight sessions over
    // twenty-three days is one unbroken streak against that schedule and four broken pieces against
    // a two-rest-day allowance, so `streak_14` (best streak, goal 14) tells the two apart.
    const id = USERS[4]
    const prog = await pool.query(`INSERT INTO programs (user_id, name, is_active) VALUES ($1,'I2663',true) RETURNING id`, [id])
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day',0) RETURNING id`, [prog.rows[0].id])
    const sc = await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [prog.rows[0].id])
    for (const dow of [1, 2]) {
      await pool.query(
        `INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [sc.rows[0].id, dow, ps.rows[0].id])
    }
    const start = shiftDateStr(today, -40)
    for (const offset of [0, 1, 7, 8, 14, 15, 21, 22]) {
      const day = shiftDateStr(start, offset)
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1,'Day',$2) RETURNING id`,
        [id, `${day}T12:00:00+10:00`])
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1,'Squat',$2)`,
        [ws.rows[0].id, `${day}T12:30:00+10:00`])
    }
    expect(await progress(id, 'streak_14')).toBeGreaterThanOrEqual(14)
  })
})

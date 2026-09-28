// BF-78. `updateUserProfile` wrote display name, height, date of birth and weight goal
// unconditionally as `?? null`, so any body omitting them erased them — a PUT wearing a PATCH's
// name. One caller already sent a one-field body (accepting an activity-level recommendation), so
// a single tap would have taken height with it, and height feeds the BMR fallback.
//
// The route was the other half: it mapped every field through `?? undefined`, which collapsed
// "sent as null" into "omitted". Fixing only the adapter would have made a field impossible to
// clear, so both halves are pinned here.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000pp001'.replace('pp0', 'ab0')

describe.skipIf(!canRun)('updateUserProfile is a real partial update', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'bf78@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(
      `UPDATE users SET display_name = 'Owner', height_cm = 160, date_of_birth = '1993-06-15',
       weight_goal_kg = 60, sex = 'male', activity_level = 'sedentary', fitness_goal = 'recomp',
       timezone = 'Australia/Brisbane' WHERE id = $1`, [USER])
  })

  const read = async () => {
    const { rows } = await pool.query(
      `SELECT display_name, height_cm, date_of_birth, weight_goal_kg, sex, activity_level, fitness_goal, timezone
       FROM users WHERE id = $1`, [USER])
    return rows[0]
  }

  // The exact body `goal-recommendation-sheet.tsx` sends when the owner accepts a recommendation.
  it('leaves every other column alone when one field is patched', async () => {
    await repo.updateUserProfile(USER, { activityLevel: 'moderate' })
    const r = await read()
    expect(r.activity_level).toBe('moderate')
    expect(r.display_name).toBe('Owner')
    expect(r.height_cm).toBe(160)
    // `pg` hands back a Date for a `date` column in a raw query, not the string it was written as —
    // at LOCAL midnight, so as an instant it is 00:00Z on CI and 14:00Z the day before on a machine
    // in Brisbane (LA-163). Compared as calendar parts in that same local zone, which is what the
    // column means; slicing an ISO string is the banned UTC-date pattern.
    const dob = r.date_of_birth as Date
    expect([dob.getFullYear(), dob.getMonth() + 1, dob.getDate()]).toEqual([1993, 6, 15])
    expect(Number(r.weight_goal_kg)).toBe(60)
    expect(r.sex).toBe('male')
    expect(r.fitness_goal).toBe('recomp')
  })

  // The other half of the same rule: omitted and null must stop meaning the same thing, or a field
  // becomes impossible to clear.
  it('clears a column when null is sent explicitly', async () => {
    await repo.updateUserProfile(USER, { heightCm: null as unknown as number })
    const r = await read()
    expect(r.height_cm).toBeNull()
    expect(r.display_name).toBe('Owner')
    expect(Number(r.weight_goal_kg)).toBe(60)
  })

  // Timezone keys every day window in the app; a user with no timezone has no "today".
  it('never clears the timezone, whether omitted or sent as null', async () => {
    await repo.updateUserProfile(USER, { displayName: 'Renamed' })
    expect((await read()).timezone).toBe('Australia/Brisbane')
    await repo.updateUserProfile(USER, { timezone: null as unknown as string })
    expect((await read()).timezone).toBe('Australia/Brisbane')
  })

  it('sets a timezone that is actually supplied', async () => {
    await repo.updateUserProfile(USER, { timezone: 'Etc/GMT-3' })
    expect((await read()).timezone).toBe('Etc/GMT-3')
  })

  // Drizzle rejects `.set({})`, so a body naming nothing known must not reach the UPDATE.
  it('is a no-op for a body with no known field, and still returns the user', async () => {
    const user = await repo.updateUserProfile(USER, {})
    expect(user.id).toBe(USER)
    expect(user.displayName).toBe('Owner')
    expect((await read()).height_cm).toBe(160)
  })
})

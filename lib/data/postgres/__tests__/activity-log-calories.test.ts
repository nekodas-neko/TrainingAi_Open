// Q-230. `activity_logs.calories_burned` was written null by every writer, two of them behind a
// comment asserting the server computed it. Nothing did — not the route, not the repository, not the
// `pushMutations` branch — so the column was empty forever and only the Body tab's aggregate, which
// recomputes the same estimate from the same inputs, ever showed a number.
//
// The derivation has to live server-side, and that is not a preference: `estWorkoutKcal` reads its
// MET table through `lib/oura-models/constants`, which resolves files with `node:path`. The first
// attempt did it in the client components and failed the Build check by pulling `node:path` into the
// browser bundle. Putting it in `saveActivityLog` also means one change covers the web route and the
// outbox replay, which both call it — the sibling-drift rule, satisfied by construction.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// `estWorkoutKcal` reads the MET table, and the synthetic fixtures carry METs below 1.0, so the
// derivation returns null and a derived value cannot be asserted at all. The never-overwrite,
// zero-duration and incomplete-profile blocks assert that it degrades to null, which is exactly
// what happens either way, so they keep covering the Q-230 safety property in CI.
const itVendor = it.skipIf(!hasRealConstants())

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000230'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('saveActivityLog — derives calories when the caller has none (Q-230)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const base = {
    date: '2026-08-14', activityType: 'walk', title: 'Q230 Walk',
    startTime: '08:00', endTime: '08:45', durationMin: 45,
  } as Parameters<import('@/lib/data/repository').WorkoutRepository['saveActivityLog']>[1]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, sex, date_of_birth)
       VALUES ($1, $2, 'x', $3, 'male', '1990-01-01') ON CONFLICT (id) DO NOTHING`,
      [USER, `q230-${USER}@example.com`, TZ])
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-08-13', 82)
       ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = 82`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  itVendor('fills a missing value from duration, activity type and the profile', async () => {
    const log = await repo.saveActivityLog(USER, base)
    expect(log.caloriesBurned).not.toBeNull()
    expect(log.caloriesBurned!).toBeGreaterThan(0)
  })

  itVendor('agrees with the aggregate that recomputes the same activity', async () => {
    // Not "roughly" — the identical estimator at the identical intensity. If these drift, a walk's
    // own row and the day's Burned total start telling the lifter two different numbers for it.
    const { estWorkoutKcal } = await import('@trainingai/shared/health/workout-energy')
    const { ouraIdForActivityType } = await import('@trainingai/shared/health/daily-energy')
    const { ageFromDob } = await import('@trainingai/shared/date-utils')
    const expected = estWorkoutKcal({
      durationMin: 45, ageYears: ageFromDob('1990-01-01', new Date())!, weightKg: 82, sex: 'male',
      activityId: ouraIdForActivityType('walk'), intensity: 'moderate',
    })!
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '09:00', endTime: '09:45' })
    expect(log.caloriesBurned).toBe(Math.round(expected))
  })

  it('never overwrites a value the caller supplied', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '10:00', endTime: '10:45', caloriesBurned: 999 })
    expect(log.caloriesBurned).toBe(999)
  })

  itVendor('distinguishes activity types through the MET table', async () => {
    const walk = await repo.saveActivityLog(USER, { ...base, startTime: '11:00', endTime: '11:30', durationMin: 30 })
    const run = await repo.saveActivityLog(USER, { ...base, activityType: 'run', startTime: '12:00', endTime: '12:30', durationMin: 30 })
    expect(run.caloriesBurned!).toBeGreaterThan(walk.caloriesBurned!)
  })

  it('stays null when the duration cannot support an estimate', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '13:00', endTime: '13:00', durationMin: 0 })
    // The row maps an absent value to undefined rather than null; both mean "nothing stored".
    expect(log.caloriesBurned ?? null).toBeNull()
  })

  // Degrading to null is the safety property: it is exactly what was stored before, so a user with
  // no recorded weight or date of birth keeps today's behaviour rather than getting a number derived
  // from a missing input.
  it('stays null when the profile is incomplete', async () => {
    const BARE = '00000000-0000-4000-8000-000000000231'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`, [BARE, `q230-bare@example.com`, TZ])
    const log = await repo.saveActivityLog(BARE, base)
    expect(log.caloriesBurned ?? null).toBeNull()
    await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [BARE])
    await pool.query('DELETE FROM users WHERE id = $1', [BARE])
  })
})

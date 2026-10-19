// Q-307. `activity_logs.avg_pace_sec_per_km` was read straight from the column and never derived,
// so it was absent on 32 of 39 logs that carried both `distance_km` and `duration_min` — the two
// inputs the pace formula needs. Every writer (`exercise-review-sheet.tsx`) sent it as an explicit
// `null`. Same shape as the calorie fix in `activity-log-calories.test.ts`: derive server-side in
// `saveActivityLog` so the web route and the outbox `pushMutations` branch both get it for free.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000307'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('saveActivityLog — derives pace when the caller has none (Q-307)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const base = {
    date: '2026-08-14', activityType: 'walk', title: 'Q307 Walk',
    startTime: '08:00', endTime: '08:45', durationMin: 30, distanceKm: 3,
  } as Parameters<import('@/lib/data/repository').WorkoutRepository['saveActivityLog']>[1]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, `q307-${USER}@example.com`, TZ])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  it('fills a missing value from distance and duration', async () => {
    const log = await repo.saveActivityLog(USER, base)
    // 30 min * 60 / 3 km = 600 sec/km.
    expect(log.avgPaceSecPerKm).toBe(600)
  })

  it('never overwrites a value the caller supplied', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '09:00', endTime: '09:45', avgPaceSecPerKm: 555 })
    expect(log.avgPaceSecPerKm).toBe(555)
  })

  it('stays null when distance is missing', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '10:00', endTime: '10:45', distanceKm: undefined })
    expect(log.avgPaceSecPerKm ?? null).toBeNull()
  })

  it('stays null when duration is missing', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '11:00', endTime: '11:45', durationMin: undefined })
    expect(log.avgPaceSecPerKm ?? null).toBeNull()
  })

  // #3120. The clients leave out an average slower than MAX_PACE_SEC_PER_KM; the server used to
  // derive it straight back in. 3 h over 2 km is 5,400 s/km.
  it('stores no pace when the derived one is slower than the cap', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '13:00', endTime: '16:00', durationMin: 180, distanceKm: 2 })
    expect(log.avgPaceSecPerKm ?? null).toBeNull()
  })

  it('still derives a pace right at the cap', async () => {
    // 120 min over 2 km is exactly 3,600 s/km.
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '17:00', endTime: '19:00', durationMin: 120, distanceKm: 2 })
    expect(log.avgPaceSecPerKm).toBe(3600)
  })

  it('stores no pace for a zero duration', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '20:00', endTime: '20:00', durationMin: 0 })
    expect(log.avgPaceSecPerKm ?? null).toBeNull()
  })

  it('stays null when distance is zero (division guard)', async () => {
    const log = await repo.saveActivityLog(USER, { ...base, startTime: '12:00', endTime: '12:45', distanceKm: 0 })
    expect(log.avgPaceSecPerKm ?? null).toBeNull()
  })
})

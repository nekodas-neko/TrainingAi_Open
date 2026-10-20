// #3115 — a Health Connect or Apple Health night follows the night ladder, so another source's copy
// of a night we already hold is not summed into it.
//
// Against a real Postgres (skips without DATABASE_URL). `sleep-night.ts` sums every live row of a night
// as a fragment, so each case checks there is one live row per night:
//   - two overlapping nights from different sources through `/api/sync-health`'s writer: the first
//     stays, the second is not written;
//   - the same source re-cutting its night: the newer cut replaces the older by tombstone;
//   - the native rebuild yields to a higher-ranked night (Oura Cloud) and takes over a lower one (a
//     legacy row with no source).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003115'

describe.skipIf(!canRun)('the night ladder for Health Connect and Apple Health (#3115)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'UTC') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3115@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['sleep_sessions', 'apple_health_samples', 'native_health_projection_days', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  const live = async () => (await pool.query(
    `SELECT to_char(sleep_start AT TIME ZONE 'UTC', 'HH24:MI') AS start, source_map->>'duration_hours' AS source
       FROM sleep_sessions WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sleep_start`, [USER])).rows
  const night = (start: string, end: string, hours: number) => ({
    date: '2026-10-11', sleepStart: new Date(start), sleepEnd: new Date(end), durationHours: hours,
  })

  it('a second source\'s overlapping copy of a stored night is not written', async () => {
    await repo.saveSleepSession(USER, night('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z', 7.5), 'apple_health')
    // The same night through Health Connect, cut by another app a few minutes apart. Equal rank.
    await repo.saveSleepSession(USER, night('2026-10-10T22:07:00Z', '2026-10-11T06:04:00Z', 7.4), 'health_connect')
    expect(await live()).toEqual([{ start: '22:00', source: 'apple_health' }])
  })

  it('the same source re-cutting its night replaces the earlier cut', async () => {
    await repo.saveSleepSession(USER, night('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z', 7.5), 'health_connect')
    await repo.saveSleepSession(USER, night('2026-10-10T21:50:00Z', '2026-10-11T06:10:00Z', 7.8), 'health_connect')
    expect(await live()).toEqual([{ start: '21:50', source: 'health_connect' }])
    const tombstoned = await pool.query(
      `SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1 AND deleted_at IS NOT NULL`, [USER])
    expect(tombstoned.rows[0].n).toBe(1)
  })

  it('a shorter fragment from the same source, arriving later, does not replace the night (#3154 review)', async () => {
    await repo.saveSleepSession(USER, night('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z', 7.5), 'health_connect')
    await repo.saveSleepSession(USER, night('2026-10-11T03:00:00Z', '2026-10-11T04:00:00Z', 1), 'health_connect')
    expect(await live()).toEqual([{ start: '22:00', source: 'health_connect' }])
  })

  it('a night that does not overlap is written alongside', async () => {
    await repo.saveSleepSession(USER, night('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z', 7.5), 'apple_health')
    await repo.saveSleepSession(USER, { ...night('2026-10-11T22:00:00Z', '2026-10-12T06:00:00Z', 7.5), date: '2026-10-12' }, 'health_connect')
    expect(await live()).toEqual([{ start: '22:00', source: 'apple_health' }, { start: '22:00', source: 'health_connect' }])
  })

  async function nativeNight(start: string, end: string) {
    const { getDb } = await import('@/lib/data/postgres/client')
    const { applyAppleHealthBatch, rebuildAppleHealth } = await import('@/lib/data/postgres/slices/apple-health')
    const db = getDb()
    await applyAppleHealthBatch(db, USER, {
      type: 'HKCategoryTypeIdentifierSleepAnalysis',
      samples: [{ id: randomUUID(), start, end, value: 4, sourceBundleId: 'com.test.watch', sourceName: 'Watch' }],
      deleted: [],
    }, 'UTC')
    await rebuildAppleHealth(db, USER, 'UTC')
  }

  it('the native rebuild does not write a night Oura Cloud already holds', async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, source_map)
       VALUES ($1, '2026-10-11', '2026-10-10T22:05:00Z', '2026-10-11T06:00:00Z', 7.3, 'oura-period-1', '{"duration_hours":"oura_cloud"}')`,
      [USER])
    await nativeNight('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z')
    expect(await live()).toEqual([{ start: '22:05', source: 'oura_cloud' }])
  })

  it('the native rebuild takes over from a lower-ranked legacy night with no source', async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours)
       VALUES ($1, '2026-10-11', '2026-10-10T22:05:00Z', '2026-10-11T06:00:00Z', 7.3)`,
      [USER])
    await nativeNight('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z')
    expect(await live()).toEqual([{ start: '22:00', source: 'apple_health' }])
  })

  it('Apple Health through both writers keeps the longer night rather than taking turns', async () => {
    // The native rebuild's night first (about 8 h), then a shorter `/api/sync-health` cut of it.
    await nativeNight('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z')
    await repo.saveSleepSession(USER, night('2026-10-10T22:30:00Z', '2026-10-11T05:30:00Z', 6.8), 'apple_health')
    expect(await live()).toEqual([{ start: '22:00', source: 'apple_health' }])
    // And the rebuild running again keeps it as the one night.
    await nativeNight('2026-10-10T22:00:00Z', '2026-10-11T06:00:00Z')
    expect(await live()).toEqual([{ start: '22:00', source: 'apple_health' }])
  })
})

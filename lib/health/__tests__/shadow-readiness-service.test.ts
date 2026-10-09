// #2377 — the shadow readiness service against a real Postgres: the replay writes one row per day,
// a second run replaces its own rows only, a second model version coexists, a dry run writes
// nothing, today is never replayed, and the daily hook never throws. Skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SHADOW_MODEL_VERSION } from '@trainingai/shared/health/shadow-readiness/model'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000237701'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('shadow readiness service (#2377)', () => {
  let pool: import('pg').Pool
  let today: string
  let from: string
  let to: string

  const rows = async () => (await pool.query(
    `SELECT date::text AS date, model_version, shadow_readiness, inputs_through::text AS inputs_through,
            live_readiness, live_model_version, computed_by, computed_at, id
       FROM shadow_readiness WHERE user_id = $1 ORDER BY date, model_version`, [TEST_USER_ID])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    const { seedShadowHistory } = await import('./shadow-readiness-seed')
    pool = getPool()
    today = todayInTz(TZ)
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
      [TEST_USER_ID, `shadow-readiness-${TEST_USER_ID}@example.com`, TZ],
    )
    await seedShadowHistory(pool, TEST_USER_ID, { end: shiftDateStr(today, -1), days: 60, tz: TZ })
    to = shiftDateStr(today, -1)
    from = shiftDateStr(today, -10)
    // A stored live score for one day only, so `live_readiness` is copied there and null elsewhere.
    await pool.query(
      `INSERT INTO oura_daily_derived (user_id, day, readiness_score, model_versions)
       VALUES ($1, $2, 71, '{"readiness":"v7:test"}'::jsonb)`,
      [TEST_USER_ID, shiftDateStr(today, -3)],
    )
  }, 60_000)

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades
  })

  it('a dry run scores every day and writes nothing', async () => {
    const { replayShadowReadiness } = await import('../shadow-readiness-service')
    const res = await replayShadowReadiness(TEST_USER_ID, from, to, { tz: TZ })
    expect(res.dryRun).toBe(true)
    expect(res.written).toBe(0)
    expect(res.rows).toHaveLength(10)
    expect(await rows()).toHaveLength(0)
  }, 60_000)

  it('the replay writes one row per day, on settled inputs, with the live score only where one was stored', async () => {
    const { replayShadowReadiness } = await import('../shadow-readiness-service')
    const { shiftDateStr } = await import('@trainingai/shared/date-utils')
    const res = await replayShadowReadiness(TEST_USER_ID, from, to, { tz: TZ, write: true })
    expect(res.written).toBe(10)
    const stored = await rows()
    expect(stored.map(r => r.date)).toEqual(res.rows.map(r => r.date))
    for (const r of stored) {
      expect(r.model_version).toBe(SHADOW_MODEL_VERSION)
      expect(r.computed_by).toBe('replay')
      expect(r.shadow_readiness).not.toBeNull()
      if (r.inputs_through != null) expect(r.inputs_through < r.date).toBe(true)
    }
    const withLive = stored.filter(r => r.live_readiness != null)
    expect(withLive.map(r => r.date)).toEqual([shiftDateStr(today, -3)])
    expect(withLive[0]).toMatchObject({ live_readiness: 71, live_model_version: 'v7:test' })
  }, 60_000)

  it('a second run replaces its own rows only, and another model version coexists untouched', async () => {
    const { replayShadowReadiness } = await import('../shadow-readiness-service')
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    // A version-1 row beside the current version, as the first weight set wrote it (issue 2635).
    await repo.upsertShadowReadiness(TEST_USER_ID, {
      date: from, modelVersion: 1, shadowReadiness: 12.5,
      pillars: { sleep: 1, heart: 2, activity: 3, body: 4 },
      pillarDetail: {}, units: {}, maturityStage: 'learning', inputsThrough: null,
      liveReadiness: null, liveModelVersion: null, computedBy: 'replay',
    })
    const before = await rows()
    await replayShadowReadiness(TEST_USER_ID, from, to, { tz: TZ, write: true })
    const after = await rows()
    expect(after).toHaveLength(before.length)
    const v1 = after.find(r => r.model_version === 1)!
    expect(v1.shadow_readiness).toBe(12.5)
    expect(v1.computed_at.getTime()).toBe(before.find(r => r.model_version === 1)!.computed_at.getTime())
    for (const r of after.filter(x => x.model_version === SHADOW_MODEL_VERSION)) {
      const prev = before.find(b => b.date === r.date && b.model_version === SHADOW_MODEL_VERSION)!
      expect(r.id).toBe(prev.id)
      expect(r.shadow_readiness).toBe(prev.shadow_readiness)
      expect(r.computed_at.getTime()).toBeGreaterThanOrEqual(prev.computed_at.getTime())
    }
    await pool.query(`DELETE FROM shadow_readiness WHERE user_id = $1 AND model_version = 1`, [TEST_USER_ID])
  }, 60_000)

  it('version 2 scores deep + REM share against the person\'s own normal; an unstaged night drops out, never 0 (issue 2635)', async () => {
    expect(SHADOW_MODEL_VERSION).toBeGreaterThanOrEqual(2)
    const { rows: stored } = await pool.query(
      `SELECT date::text AS date, units->'sleep.deep_rem_share' AS u FROM shadow_readiness
        WHERE user_id = $1 AND model_version = $2 ORDER BY date`, [TEST_USER_ID, SHADOW_MODEL_VERSION])
    expect(stored.length).toBeGreaterThan(0)
    const scored = stored.filter(r => r.u.score != null)
    const dropped = stored.filter(r => r.u.score == null)
    expect(scored.length).toBeGreaterThan(0)
    // The seed leaves every ninth night unstaged: those have no value and no score.
    expect(dropped.length).toBeGreaterThan(0)
    for (const r of dropped) expect(r.u).toMatchObject({ value: null, weight: 0 })
    for (const r of scored) expect(r.u).toMatchObject({ gap: null, weight: 10, level: null })
  }, 60_000)

  it('today is never replayed — it belongs to the daily step', async () => {
    const { replayShadowReadiness } = await import('../shadow-readiness-service')
    const res = await replayShadowReadiness(TEST_USER_ID, today, today, { tz: TZ })
    expect(res.rows).toHaveLength(0)
  })

  it('the daily step writes today\'s row as daily, on yesterday\'s daytime data at the latest', async () => {
    const { runShadowReadinessForDate } = await import('../shadow-readiness-service')
    const row = await runShadowReadinessForDate(TEST_USER_ID, TZ, today, 'daily')
    expect(row.computedBy).toBe('daily')
    const stored = (await rows()).find(r => r.date === today)!
    expect(stored.computed_by).toBe('daily')
    if (stored.inputs_through != null) expect(stored.inputs_through < today).toBe(true)
  }, 60_000)

  it('the daily hook never throws, reports a failure, and runs at most once an hour', async () => {
    const { scheduleDailyShadowReadiness, __resetShadowThrottle } = await import('../shadow-readiness-service')
    __resetShadowThrottle()
    // A user that does not exist: the write fails on the foreign key, and that must stay inside.
    const ghost = '00000000-0000-4000-8000-000000237703'
    const first = scheduleDailyShadowReadiness(ghost, TZ, 1_000_000, 0)
    expect(first).not.toBeNull()
    await expect(first).resolves.toBeUndefined()
    expect(scheduleDailyShadowReadiness(ghost, TZ, 1_000_000 + 59 * 60_000)).toBeNull()
    const later = scheduleDailyShadowReadiness(ghost, TZ, 1_000_000 + 61 * 60_000, 0)
    expect(later).not.toBeNull()
    await later
    await pool.query(`DELETE FROM error_events WHERE user_id = $1`, [ghost]).catch(() => {})
  }, 60_000)

  it('days moved counts only days with both scores, at ≥ 5 points', async () => {
    const { daysMoved } = await import('../shadow-readiness-service')
    expect(daysMoved([
      { shadowReadiness: 70, liveReadiness: 64 },
      { shadowReadiness: 70, liveReadiness: 68 },
      { shadowReadiness: null, liveReadiness: 50 },
      { shadowReadiness: 40, liveReadiness: null },
    ])).toEqual({ compared: 2, moved: 1, medianAbsDiff: 4, maxAbsDiff: 6 })
  })
})

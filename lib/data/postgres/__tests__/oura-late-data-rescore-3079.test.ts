// #3079 — the statements behind re-scoring a night Oura changed, against a real Postgres.
//
// - `clearNightDerivedScores` nulls only the named pillar's columns, and says whether it changed a row;
// - `releaseBodyBatteryAnchor` un-freezes only a `readiness` anchor;
// - `oura_cloud_daily.updated_at` moves only when a written value changed, which is what the
//   training-stress re-check reads (`getOuraCloudMetChangedAt`);
// - `listOuraCloudConnectedUserIds` finds a live OAuth connection;
// - end to end: an Oura delete of today's night, bracketed by `withNightRescore`, clears the day's
//   stored sleep score and readiness.
//
// Fixtures are built from today's local date and anchored at local times inside the day (dates rule).
// Skips without DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003079'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

describe.skipIf(!canRun)('Oura late data re-scores its day (#3079)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const savedKey = process.env.OURA_TOKEN_KEY
  const today = todayInTz(TZ)

  beforeAll(async () => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3079@example.com', TZ])
  })

  afterAll(async () => {
    process.env.OURA_TOKEN_KEY = savedKey
    if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    for (const t of ['oura_daily_derived', 'body_battery_daily', 'oura_cloud_daily', 'sleep_sessions', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  const derivedRow = async (day: string) =>
    (await pool.query(`SELECT sleep_score, sleep_contributors, readiness_score, readiness_contributors, activity_score, model_versions
                         FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [USER, day])).rows[0]

  it('clears only the named pillar, and reports whether it changed anything', async () => {
    await repo.upsertOuraDailyDerived(USER, today, {
      sleepScore: 80, sleepContributors: { efficiency: 90 }, readinessScore: 70, readinessContributors: { hrv: 1 }, activityScore: 60,
    })
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: true, readiness: false })).toBe(true)
    let row = await derivedRow(today)
    expect(row.sleep_score).toBeNull()
    expect(row.sleep_contributors).toBeNull()
    expect(row.readiness_score).toBe(70)
    expect(row.activity_score).toBe(60)
    // Nothing left to clear: no change.
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: true, readiness: false })).toBe(false)
    expect(await repo.clearNightDerivedScores(USER, today, { sleep: false, readiness: true })).toBe(true)
    row = await derivedRow(today)
    expect(row.readiness_score).toBeNull()
    expect(row.activity_score).toBe(60)
  })

  it('releases a readiness anchor and leaves a provisional one alone', async () => {
    const base = { anchor: 72, endValue: 50, dayMin: 40, dayMax: 72, totalCharged: 0, totalDrained: 22, restingHr: 52, hrMax: 180, hrMaxObserved: null, hrSampleCount: 300, modelVersion: 'v7' }
    await repo.upsertBodyBatteryDaily(USER, { ...base, date: today, anchorSource: 'readiness' })
    await repo.upsertBodyBatteryDaily(USER, { ...base, date: shiftDateStr(today, -1), anchorSource: 'sleep' })
    expect(await repo.releaseBodyBatteryAnchor(USER, today)).toBe(true)
    expect(await repo.releaseBodyBatteryAnchor(USER, shiftDateStr(today, -1))).toBe(false)
    const rows = (await pool.query(`SELECT date::text, anchor_source FROM body_battery_daily WHERE user_id = $1 ORDER BY date`, [USER])).rows
    expect(rows).toEqual([{ date: shiftDateStr(today, -1), anchor_source: 'sleep' }, { date: today, anchor_source: 'default' }])
  })

  it("moves oura_cloud_daily.updated_at only when a value changed, and reports MET's change", async () => {
    const day = shiftDateStr(today, -1)
    const met = { interval: 60, items: [1.1, 1.2, 1.3], timestamp: `${day}T04:00:00.000+10:00` }
    const stamp = async () => (await pool.query(`SELECT updated_at FROM oura_cloud_daily WHERE user_id = $1 AND date = $2`, [USER, day])).rows[0].updated_at as Date
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met, class5Min: '111' }])
    const first = await stamp()
    await pool.query(`SELECT pg_sleep(0.05)`)
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met, class5Min: '111' }])
    expect((await stamp()).getTime()).toBe(first.getTime())
    await repo.upsertOuraCloudDaily(USER, [{ date: day, met: { ...met, items: [1.1, 1.2, 2.4] }, class5Min: '111' }])
    const changed = await stamp()
    expect(changed.getTime()).toBeGreaterThan(first.getTime())
    expect(await repo.getOuraCloudMetChangedAt(USER, shiftDateStr(day, -1), day)).toEqual([{ date: day, changedAt: changed }])
  })

  it('lists a live OAuth connection', async () => {
    await repo.saveOuraCloudTokens(USER, {
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'extapi:daily', ouraUserId: 'oura-3079',
    })
    expect(await repo.listOuraCloudConnectedUserIds()).toContain(USER)
  })

  it("an Oura delete of today's night clears today's sleep score and readiness", async () => {
    const { withNightRescore } = await import('@/lib/health/rescore-nights')
    const nights = Array.from({ length: 10 }, (_, i) => {
      const date = shiftDateStr(today, -9 + i)
      const mid = dateStrMidnightInTz(date, TZ).getTime()
      return {
        ouraId: `cloud-3079-${date}`, date, sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
        durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6, efficiency: 90,
      }
    })
    await repo.upsertOuraCloudSleep(USER, nights)
    await repo.upsertOuraDailyDerived(USER, today, { sleepScore: 81, readinessScore: 73, activityScore: 55 })

    const tombstoned = await withNightRescore(repo, USER, () => repo.tombstoneOuraCloudSleep(USER, [`cloud-3079-${today}`]))

    expect(tombstoned).toBe(1)
    const row = await derivedRow(today)
    expect(row.sleep_score).toBeNull()
    expect(row.readiness_score).toBeNull()
    expect(row.activity_score).toBe(55)
  })
})

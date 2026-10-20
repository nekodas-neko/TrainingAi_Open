// #3060 — Oura's period type reaches the device through the delta pull.
//
// Against a real Postgres (skips without DATABASE_URL). Oura is not called: documents are built from
// the spec-shaped fixtures and written through `writeOuraCloudData`, the path the webhook and backfill use.
//   - the delta's sleep rows carry `ouraSleepType`, joined from `oura_cloud_sleep_periods` by Oura id;
//   - a period retype moves the night's `updated_at`, so an incremental pull re-sends it, including a
//     period-only write the sleep upsert never sees; a same-type period write does not move it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003060'

describe.skipIf(!canRun)('Oura sleep type in the delta pull (#3060)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3060@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['sleep_sessions', 'oura_cloud_sleep_periods', 'body_metrics', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  async function writeSleep(...docs: Record<string, unknown>[]) {
    const { mapOuraDocuments, SleepDoc } = await import('@/lib/oura/cloud/documents')
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    return writeOuraCloudData(repo, USER, mapOuraDocuments(docs.map(d => ({ type: 'sleep' as const, doc: SleepDoc.parse(d) }))), repo)
  }
  const pull = async (since: Date) =>
    (await repo.getSyncDelta(USER, since, null)).sleepSessions as { ouraId: string | null; ouraSleepType: string | null; updatedAt: Date }[]
  const tick = () => new Promise(r => setTimeout(r, 20))

  it("sends each Oura night with its period type, and null for a night from another source", async () => {
    await writeSleep(sleepPeriod)
    await repo.saveSleepSession(USER, {
      date: '2026-09-01', sleepStart: new Date('2026-08-31T12:00:00Z'), sleepEnd: new Date('2026-08-31T20:00:00Z'), durationHours: 7.5,
    }, 'health_connect')
    const rows = await pull(new Date(0))
    expect(rows.map(r => [r.ouraId, r.ouraSleepType]).sort()).toEqual([[null, null], ['sl-1', 'long_sleep']])
  })

  it('a retype re-sends the night to a device that already pulled it', async () => {
    await writeSleep({ ...sleepPeriod, type: 'sleep' })
    const [first] = await pull(new Date(0))
    expect(first.ouraSleepType).toBe('sleep')
    await tick()
    const since = new Date()
    await tick()

    await writeSleep(sleepPeriod) // Oura re-sends the period as long_sleep, nothing else changed
    const resent = await pull(since)
    expect(resent.map(r => [r.ouraId, r.ouraSleepType])).toEqual([['sl-1', 'long_sleep']])
  })

  it('a period write that only retypes moves the night, a same-type write does not', async () => {
    await writeSleep(sleepPeriod)
    const stamp = async () => (await pool.query(`SELECT updated_at FROM sleep_sessions WHERE user_id = $1 AND oura_id = 'sl-1'`, [USER])).rows[0].updated_at as Date
    const before = await stamp()
    const { upsertOuraCloudSleepPeriods } = await import('@/lib/data/postgres/slices/oura')
    const { getDb } = await import('@/lib/data/postgres/client')
    const row = (await pool.query(`SELECT * FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])).rows[0]
    const period = {
      ouraId: 'sl-1', day: row.day, bedtimeStart: row.bedtime_start, bedtimeEnd: row.bedtime_end, sleepType: 'long_sleep',
      heartRate: null, hrv: null, sleepPhase30Sec: null, movement30Sec: null, sleepAlgorithmVersion: null,
      lowBatteryAlert: null, sleepAnalysisReason: null, period: 0, ringId: null,
    }
    await tick()
    await upsertOuraCloudSleepPeriods(getDb(), USER, [period])
    expect(await stamp()).toEqual(before)
    await tick()
    await upsertOuraCloudSleepPeriods(getDb(), USER, [{ ...period, sleepType: 'sleep' }])
    expect((await stamp()).getTime()).toBeGreaterThan(before.getTime())
  })
})

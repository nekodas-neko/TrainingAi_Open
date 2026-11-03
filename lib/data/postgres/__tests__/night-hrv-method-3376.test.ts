// #3376 — a night whose HRV is the source's own nightly average, not a series median, still counts and
// is marked, generically, in the row's per-field provenance.
//
// Against a real Postgres (skips without DATABASE_URL). Oura is not called: the Oura connector is just
// the first source through the path; the documents are the spec-shaped fixtures, written through
// `writeOuraCloudData`, the path the webhook and backfill use. What is read back is the generic
// `BodyMetrics.hrvMethod`, the shape readiness reads for any source.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY, sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003376'

describe.skipIf(!canRun)('a night is marked with how its HRV was reached (#3376)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3376@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['sleep_sessions', 'oura_cloud_sleep_periods', 'body_metrics', 'oura_raw_samples', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    const { resetOuraCloudReportThrottle } = await import('@/lib/oura/cloud/report')
    resetOuraCloudReportThrottle()
  })

  async function writeSleep(...docs: Record<string, unknown>[]) {
    const { mapOuraDocuments, SleepDoc } = await import('@/lib/oura/cloud/documents')
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    return writeOuraCloudData(repo, USER, mapOuraDocuments(docs.map(d => ({ type: 'sleep' as const, doc: SleepDoc.parse(d) }))), repo)
  }
  const night = async () => (await repo.listBodyMetrics(USER, DAY, DAY))[0] ?? null
  const series = { interval: 300, items: [45, 47, 49, 51, 96], timestamp: '2026-10-09T22:30:00+10:00' }

  it('a night with a usable series is the median, marked series_median', async () => {
    await writeSleep({ ...sleepPeriod, average_hrv: 70, hrv: series })
    expect(await night()).toMatchObject({ hrvMs: 49, hrvSource: 'oura_cloud', hrvMethod: 'series_median' })
  })

  it("a night with no usable series keeps the source's average, still counts, and is marked source_average", async () => {
    await writeSleep({ ...sleepPeriod, average_hrv: 66, hrv: null })
    expect(await night()).toMatchObject({ hrvMs: 66, hrvSource: 'oura_cloud', hrvMethod: 'source_average' })
    // The mark is generic provenance: named for the method, holding whichever source wrote it.
    const map = (await pool.query(`SELECT source_map FROM body_metrics WHERE user_id = $1 AND date = $2`, [USER, DAY])).rows[0].source_map
    expect(map['hrv_ms:source_average']).toBe('oura_cloud')
    expect(map['hrv_ms:series_median']).toBeUndefined()
  })

  it('a series that arrives later replaces the average and its mark', async () => {
    await writeSleep({ ...sleepPeriod, average_hrv: 66, hrv: null })
    await writeSleep({ ...sleepPeriod, average_hrv: 66, hrv: series })
    expect(await night()).toMatchObject({ hrvMs: 49, hrvMethod: 'series_median' })
    const map = (await pool.query(`SELECT source_map FROM body_metrics WHERE user_id = $1 AND date = $2`, [USER, DAY])).rows[0].source_map
    expect(map['hrv_ms:source_average']).toBeUndefined()
  })

  it("a higher-ranked source's value is not marked with the lower source's method", async () => {
    await writeSleep({ ...sleepPeriod, average_hrv: 66, hrv: null })
    await repo.upsertBodyMetrics(USER, [{ date: DAY, hrvMs: 55 }], 'manual')
    expect(await night()).toMatchObject({ hrvMs: 55, hrvSource: 'manual' })
    expect((await night())?.hrvMethod).toBeUndefined()
    // And a later Oura write, which loses the merge to manual, stamps nothing.
    await writeSleep({ ...sleepPeriod, average_hrv: 66, hrv: series })
    expect((await night())?.hrvMethod).toBeUndefined()
  })

  it('a night with neither keeps no HRV and no mark', async () => {
    await writeSleep({ ...sleepPeriod, average_hrv: null, hrv: null })
    expect((await night())?.hrvMs).toBeUndefined()
    expect((await night())?.hrvMethod).toBeUndefined()
  })
})

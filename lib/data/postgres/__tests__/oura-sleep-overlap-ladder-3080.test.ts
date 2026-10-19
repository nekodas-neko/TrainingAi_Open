// #3080 — an Oura sleep period that overlaps another stored night follows the source ladder, per night.
//
// Against a real Postgres (skips without DATABASE_URL). Oura is not called: documents are built from the
// spec-shaped fixtures and written through `writeOuraCloudData`, the path the webhook and backfill use.
//   - a manual, Health Connect or stale Oura row that overlaps yields by tombstone, never a delete, and
//     a Health Connect re-sync does not bring it back;
//   - the ring's night before the switch day keeps the night, and the skip is reported (counts only);
//   - a start move blocked by a tombstone at the new start no longer breaks the Oura-id unique key;
//   - a `rest` retype is tombstoned like a delete, the period keeping Oura's type;
//   - `body_metrics` HRV and resting HR follow the day's main period across separate writes, and clear.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY, sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003080'

describe.skipIf(!canRun)('Oura sleep overlap follows the source ladder (#3080)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3080@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['sleep_sessions', 'oura_cloud_sleep_periods', 'body_metrics', 'oura_raw_samples', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    reportServerError.mockReset()
    const { resetOuraCloudReportThrottle } = await import('@/lib/oura/cloud/report')
    resetOuraCloudReportThrottle()
  })

  /** Writes Oura sleep documents the way the webhook and backfill do. */
  async function writeSleep(...docs: Record<string, unknown>[]) {
    const { mapOuraDocuments, SleepDoc } = await import('@/lib/oura/cloud/documents')
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    return writeOuraCloudData(repo, USER, mapOuraDocuments(docs.map(d => ({ type: 'sleep' as const, doc: SleepDoc.parse(d) }))), repo)
  }
  const nights = async () => (await pool.query(
    `SELECT oura_id, manual_entry, deleted_at IS NOT NULL AS gone, source_map->>'duration_hours' AS source
       FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start, oura_id`, [USER])).rows
  const vitals = async () => (await pool.query(
    `SELECT hrv_ms, resting_heart_rate, source_map->>'hrv_ms' AS hrv_source FROM body_metrics WHERE user_id = $1 AND date = $2`, [USER, DAY])).rows[0] ?? null
  const reports = () => reportServerError.mock.calls.map(c => (c[0] as Error).message)
  const settle = () => new Promise(r => setTimeout(r, 30))

  it('a Health Connect night that arrived first yields to Oura, and its next sync does not bring it back', async () => {
    const hc = { date: DAY, sleepStart: new Date('2026-10-09T12:10:00Z'), sleepEnd: new Date('2026-10-09T20:20:00Z'), durationHours: 7.6 }
    await repo.saveSleepSession(USER, hc, 'health_connect')

    const counts = await writeSleep(sleepPeriod)
    expect(counts).toMatchObject({ sleepWritten: 1, sleepSkippedOverlap: 0 })
    expect(await nights()).toEqual([
      { oura_id: null, manual_entry: false, gone: true, source: 'health_connect' },
      { oura_id: 'sl-1', manual_entry: false, gone: false, source: 'oura_cloud' },
    ])

    await repo.saveSleepSession(USER, hc, 'health_connect')
    expect((await nights()).filter(n => !n.gone).map(n => n.oura_id)).toEqual(['sl-1'])
  })

  it("the ring's night before the switch day keeps the night, and the skip is reported with counts only", async () => {
    await repo.upsertOuraSleep(USER, [{
      ouraId: 'ble:1', date: DAY, sleepStart: new Date('2026-10-09T12:34:00Z'), sleepEnd: new Date('2026-10-09T20:28:00Z'), durationHours: 7.1,
    }], 'oura_ble')

    const counts = await writeSleep(sleepPeriod)
    expect(counts).toMatchObject({ sleepWritten: 0, sleepSkippedOverlap: 1 })
    expect((await nights()).filter(n => !n.gone).map(n => n.oura_id)).toEqual(['ble:1'])
    await settle()
    expect(reports()).toEqual(['oura_cloud sleep:skipped-overlap: 1 Oura sleep period(s) kept out by a higher-ranked night'])
  })

  it('a stale Oura period under another id yields to the one Oura sends now', async () => {
    await writeSleep({ ...sleepPeriod, id: 'old-id', bedtime_start: '2026-10-09T22:40:00+10:00', bedtime_end: '2026-10-10T05:30:00+10:00' })
    await writeSleep(sleepPeriod)
    expect((await nights()).map(n => [n.oura_id, n.gone])).toEqual([['sl-1', false], ['old-id', true]])
  })

  it('a start move blocked by a tombstone at the new start keeps one row per Oura id, live at the new start', async () => {
    // A night Oura later deleted sits at 22:40; sl-1 starts at 22:30.
    await writeSleep({ ...sleepPeriod, id: 'gone-1', bedtime_start: '2026-10-09T22:40:00+10:00', bedtime_end: '2026-10-09T23:10:00+10:00' })
    await repo.tombstoneOuraCloudSleep(USER, ['gone-1'])
    await writeSleep({ ...sleepPeriod, bedtime_start: '2026-10-09T23:30:00+10:00' })
    // Oura re-analyses sl-1 to start at 22:40, where the tombstone sits: this used to fail the unique key.
    await expect(writeSleep({ ...sleepPeriod, bedtime_start: '2026-10-09T22:40:00+10:00' })).resolves.toMatchObject({ sleepWritten: 1 })

    const live = (await pool.query(`SELECT oura_id, sleep_start FROM sleep_sessions WHERE user_id = $1 AND deleted_at IS NULL`, [USER])).rows
    expect(live).toHaveLength(1)
    expect(live[0].oura_id).toBe('sl-1')
    expect(live[0].sleep_start.toISOString()).toBe('2026-10-09T12:40:00.000Z')
    const holders = (await pool.query(`SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1 AND oura_id = 'sl-1'`, [USER])).rows[0].n
    expect(holders).toBe(1)
  })

  it('a period Oura retypes to rest is tombstoned like a delete, and its period keeps the type', async () => {
    await writeSleep(sleepPeriod)
    await writeSleep({ ...sleepPeriod, type: 'rest' })
    expect((await nights()).map(n => [n.oura_id, n.gone])).toEqual([['sl-1', true]])
    expect((await pool.query(`SELECT sleep_type FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])).rows).toEqual([{ sleep_type: 'rest' }])
    // The day's sleep vitals went with it.
    expect(await vitals()).toMatchObject({ hrv_ms: null, resting_heart_rate: null })
  })

  it("HRV and resting HR follow the day's main period across separate writes, and clear when it goes", async () => {
    // Two webhooks: the long night first, then a shorter long_sleep the same day. The longer one wins.
    await writeSleep(sleepPeriod)
    await writeSleep({ ...sleepPeriod, id: 'sl-2', bedtime_start: '2026-10-10T13:00:00+10:00', bedtime_end: '2026-10-10T15:00:00+10:00', total_sleep_duration: 6000, average_hrv: 90, lowest_heart_rate: 40 })
    expect(await vitals()).toEqual({ hrv_ms: 62, resting_heart_rate: 47, hrv_source: 'oura_cloud' })

    // Oura revises the main night's HRV to null: the value goes, rather than standing.
    await writeSleep({ ...sleepPeriod, average_hrv: null })
    expect(await vitals()).toMatchObject({ hrv_ms: null, resting_heart_rate: 47 })

    // The main night is deleted, as the webhook's delete path does it: the remaining long_sleep is the
    // main period now.
    const { withNightRescore } = await import('@/lib/health/rescore-nights')
    await withNightRescore(repo, USER, async () => {
      await repo.tombstoneOuraCloudSleep(USER, ['sl-1'])
      await repo.syncOuraMainSleepBodyMetrics(USER, { days: [], ouraIds: ['sl-1'] })
    })
    expect(await vitals()).toMatchObject({ hrv_ms: 90, resting_heart_rate: 40 })
  })

  it("a night Oura typed sleep, with no long_sleep, still writes the day's vitals", async () => {
    await writeSleep({ ...sleepPeriod, type: 'sleep' })
    expect(await vitals()).toMatchObject({ hrv_ms: 62, resting_heart_rate: 47 })
  })

  it("never clears a vital the ring or a manual entry owns", async () => {
    await repo.upsertBodyMetrics(USER, [{ date: DAY, hrvMs: 55 }], 'manual')
    await writeSleep({ ...sleepPeriod, type: 'rest' })
    expect(await vitals()).toMatchObject({ hrv_ms: 55, hrv_source: 'manual' })
  })

  // ── #3106 review ────────────────────────────────────────────────────────────────────────────

  it.each([['stale first'], ['new first']])('a batch holding a stale and a new version of one night ends with one live row (%s)', async order => {
    const stale = { ...sleepPeriod, id: 'old-id', bedtime_start: '2026-10-09T22:40:00+10:00', bedtime_end: '2026-10-10T05:30:00+10:00' }
    await writeSleep(stale)
    await writeSleep(...(order === 'stale first' ? [stale, sleepPeriod] : [sleepPeriod, stale]))
    expect((await nights()).filter(n => !n.gone)).toHaveLength(1)
  })

  it('a manual night Oura covered comes back when Oura deletes its period', async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry)
       VALUES ($1, $2, '2026-10-09T12:00:00Z', '2026-10-09T20:00:00Z', 8, true)`, [USER, DAY])
    await writeSleep(sleepPeriod)
    expect((await repo.listSleepSessions(USER, DAY, DAY)).map(r => r.manualEntry ?? false)).toEqual([false])

    const { withNightRescore } = await import('@/lib/health/rescore-nights')
    await withNightRescore(repo, USER, async () => {
      await repo.tombstoneOuraCloudSleep(USER, ['sl-1'])
      await repo.syncOuraMainSleepBodyMetrics(USER, { days: [], ouraIds: ['sl-1'] })
    })
    expect((await repo.listSleepSessions(USER, DAY, DAY)).map(r => r.manualEntry)).toEqual([true])
  })

  it('a manual night Oura covered comes back when Oura retypes its period to rest', async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry)
       VALUES ($1, $2, '2026-10-09T12:00:00Z', '2026-10-09T20:00:00Z', 8, true)`, [USER, DAY])
    await writeSleep(sleepPeriod)
    await writeSleep({ ...sleepPeriod, type: 'rest' })
    expect((await repo.listSleepSessions(USER, DAY, DAY)).map(r => r.manualEntry)).toEqual([true])
  })

  it('never takes HRV or resting HR from a nap: a daytime sleep period or a late_nap', async () => {
    await writeSleep(
      { ...sleepPeriod, id: 'nap-day', type: 'sleep', bedtime_start: '2026-10-10T14:00:00+10:00', bedtime_end: '2026-10-10T15:30:00+10:00', total_sleep_duration: 5000, average_hrv: 90, lowest_heart_rate: 40 },
      { ...sleepPeriod, id: 'nap-late', type: 'late_nap', bedtime_start: '2026-10-10T18:00:00+10:00', bedtime_end: '2026-10-10T19:00:00+10:00', total_sleep_duration: 3000, average_hrv: 95, lowest_heart_rate: 39 },
    )
    expect(await vitals()).toBeNull()
  })

  it('a revision of the same id that widens over a fragment tombstones the fragment and keeps one row per id', async () => {
    await writeSleep({ ...sleepPeriod, id: 'frag', bedtime_start: '2026-10-10T06:40:00+10:00', bedtime_end: '2026-10-10T07:00:00+10:00', total_sleep_duration: 900 })
    await writeSleep(sleepPeriod)
    await writeSleep({ ...sleepPeriod, bedtime_end: '2026-10-10T07:10:00+10:00' })
    expect((await nights()).map(n => [n.oura_id, n.gone])).toEqual([['sl-1', false], ['frag', true]])
    expect((await pool.query(`SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1 AND oura_id = 'sl-1'`, [USER])).rows[0].n).toBe(1)
  })

  it('a delete then a re-create of the same period revives its row, live once', async () => {
    await writeSleep(sleepPeriod)
    const [{ id }] = (await pool.query(`SELECT id FROM sleep_sessions WHERE user_id = $1`, [USER])).rows
    await repo.tombstoneOuraCloudSleep(USER, ['sl-1'])
    await writeSleep(sleepPeriod)
    const rows = (await pool.query(`SELECT id, deleted_at IS NOT NULL AS gone FROM sleep_sessions WHERE user_id = $1`, [USER])).rows
    expect(rows).toEqual([{ id, gone: false }])
    expect(await vitals()).toMatchObject({ hrv_ms: 62, resting_heart_rate: 47 })
  })
})

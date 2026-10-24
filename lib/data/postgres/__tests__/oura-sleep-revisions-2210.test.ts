// #2210 — a night Oura revises is recorded in `sleep_session_revisions`, with the old and new value of
// each field that changed. Against a real Postgres (skips without DATABASE_URL); Oura is not called:
// documents are built from the spec-shaped fixtures and written through `writeOuraCloudData`, the
// path the webhook and backfill use.
//   - the first write of a night records nothing;
//   - a re-delivery of identical values records nothing;
//   - a changed night records one revision holding old -> new for the fields that moved;
//   - for a user outside Brisbane, `day` is Oura's day for the night, not the UTC date of its instants.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DAY, sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'
import { sleepRevisionChanges } from '@/lib/data/postgres/slices/oura'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002210'

describe('sleepRevisionChanges (#2210)', () => {
  const night = {
    date: DAY, sleepStart: new Date('2026-10-09T12:30:00Z'), sleepEnd: new Date('2026-10-09T20:30:00Z'),
    durationHours: 7.25, deepSleepHours: 1.5, remSleepHours: 2, lightSleepHours: 3.75, awakHours: 0.75,
    efficiency: 91, onsetLatencySec: 600, averageHrvMs: 62, avgHeartRate: 54, lowestHeartRate: 47,
    restlessPeriods: 180, respiratoryRate: 14.6, sleepPhase5Min: '4422113', timeInBedHours: 8,
  }
  it('is null when nothing tracked differs', () => {
    expect(sleepRevisionChanges(night, { ...night, sleepEnd: new Date(night.sleepEnd) })).toBeNull()
  })
  it('names only the fields that differ, instants as ISO strings, and tolerates a field going missing', () => {
    const out = sleepRevisionChanges(night, { ...night, sleepEnd: new Date('2026-10-09T21:26:00Z'), efficiency: null })
    expect(out).toEqual({
      sleepEnd: { old: '2026-10-09T20:30:00.000Z', new: '2026-10-09T21:26:00.000Z' },
      efficiency: { old: 91, new: null },
    })
  })
})

describe.skipIf(!canRun)('Oura sleep revisions are recorded (#2210)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'America/Los_Angeles') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-2210@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['sleep_session_revisions', 'sleep_sessions', 'oura_cloud_sleep_periods', 'body_metrics', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  async function writeSleep(...docs: Record<string, unknown>[]) {
    const { mapOuraDocuments, SleepDoc } = await import('@/lib/oura/cloud/documents')
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    return writeOuraCloudData(repo, USER, mapOuraDocuments(docs.map(d => ({ type: 'sleep' as const, doc: SleepDoc.parse(d) }))), repo)
  }
  const revisions = async () => (await pool.query(
    `SELECT oura_id, day::text AS day, source, changes FROM sleep_session_revisions WHERE user_id = $1 ORDER BY revised_at`, [USER])).rows

  // A night in Los Angeles: 22:30 to 06:30 local is 05:30Z to 13:30Z, so the instants' UTC dates are the 10th
  // and the night's Oura day is the 10th; the revised end below crosses into the UTC 11th.
  const la = {
    ...sleepPeriod, day: DAY,
    bedtime_start: '2026-10-09T22:30:00-07:00', bedtime_end: '2026-10-10T06:30:00-07:00',
    heart_rate: { interval: 300, items: [58], timestamp: '2026-10-09T22:30:00-07:00' },
    hrv: { interval: 600, items: [48], timestamp: '2026-10-09T22:30:00-07:00' },
  }

  it('records nothing for the first write of a night', async () => {
    await writeSleep(la)
    expect(await revisions()).toEqual([])
  })

  it('records nothing when the same night is delivered again with identical values', async () => {
    await writeSleep(la)
    await writeSleep(la)
    await writeSleep(la)
    expect(await revisions()).toEqual([])
  })

  it('records one revision with old -> new when Oura changes the night', async () => {
    await writeSleep(la)
    await writeSleep({ ...la, bedtime_end: '2026-10-10T17:26:00-07:00', total_sleep_duration: 27_000, efficiency: 93 })
    const rows = await revisions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ oura_id: 'sl-1', day: DAY, source: 'oura_cloud' })
    expect(rows[0].changes).toMatchObject({
      sleepEnd: { old: '2026-10-10T13:30:00.000Z', new: '2026-10-11T00:26:00.000Z' },
      efficiency: { old: 91, new: 93 },
    })
    expect(rows[0].changes.durationHours.new).toBeGreaterThan(rows[0].changes.durationHours.old)
    // The same revised night delivered again is no new revision.
    await writeSleep({ ...la, bedtime_end: '2026-10-10T17:26:00-07:00', total_sleep_duration: 27_000, efficiency: 93 })
    expect(await revisions()).toHaveLength(1)
  })

  it('records the night\'s Oura day, not the UTC date of its instants, when the start moves', async () => {
    await writeSleep(la)
    await writeSleep({ ...la, bedtime_start: '2026-10-09T17:00:00-07:00' })
    const rows = await revisions()
    expect(rows).toHaveLength(1)
    expect(rows[0].day).toBe(DAY)
    expect(rows[0].changes.sleepStart).toEqual({ old: '2026-10-10T05:30:00.000Z', new: '2026-10-10T00:00:00.000Z' })
  })
})

// #3075 stage 3 — an Oura Cloud night's real onset, final wake and awakenings come from its stored
// 30-second hypnogram, on read. Against a real Postgres (skips without DATABASE_URL); documents are
// built from the spec-shaped fixtures and written through `writeOuraCloudData`.
//   - `getOuraMainSleepPeriods` returns the shape beside the other detail, from its one query;
//   - `listSleepSessions` carries onset, final wake and awakenings on the row, and `sleepStart` and
//     `sleepEnd` stay the bed window (the row's unique key);
//   - a period with no usable hypnogram, and a row from any other source, carry none.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003075'
const TZ = 'Australia/Brisbane'
// Bed window 22:30 to 06:30 Brisbane (the fixture's). Asleep from 22:35: 10 awake epochs first.
const HYPNOGRAM = '4'.repeat(10) + '2'.repeat(60) + '44' + '1'.repeat(40) + '4' + '3'.repeat(30) + '444' + '2'.repeat(20) + '4'.repeat(8)

describe.skipIf(!canRun)('Oura hypnogram onset and wake (#3075 stage 3)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3075@example.com', TZ])
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
  const bed = new Date(sleepPeriod.bedtime_start)
  const at = (epoch: number) => new Date(bed.getTime() + epoch * 30_000)

  it('the main period carries the shape beside the rest of its detail', async () => {
    await writeSleep({ ...sleepPeriod, sleep_phase_30_sec: HYPNOGRAM })
    const { getOuraMainSleepPeriods } = await import('@/lib/data/postgres/slices/oura')
    const { getDb } = await import('@/lib/data/postgres/client')
    const [main] = await getOuraMainSleepPeriods(getDb(), USER, [sleepPeriod.day], TZ)
    expect(main.sleepShape).toEqual({ sleepOnset: at(10), finalWake: at(166), awakenings: 3, wasoMin: 3 })
  })

  it('the row carries onset, final wake and awakenings, and keeps the bed window and Oura\'s own count', async () => {
    await writeSleep({ ...sleepPeriod, sleep_phase_30_sec: HYPNOGRAM })
    const [row] = await repo.listSleepSessions(USER, sleepPeriod.day, sleepPeriod.day)
    expect(row.onsetAt).toEqual(at(10))
    expect(row.finalWakeAt).toEqual(at(166))
    expect(row.computedAwakenings).toBe(3)
    expect(row.sleepStart).toEqual(bed)
    expect(row.sleepEnd).toEqual(new Date(sleepPeriod.bedtime_end))
    expect(row.restlessPeriods).toBe(sleepPeriod.restless_periods)
  })

  it('a period whose hypnogram is too short to trust carries none, and the row is as it was', async () => {
    await writeSleep(sleepPeriod) // the fixture's string is 7 epochs
    const { getOuraMainSleepPeriods } = await import('@/lib/data/postgres/slices/oura')
    const { getDb } = await import('@/lib/data/postgres/client')
    expect((await getOuraMainSleepPeriods(getDb(), USER, [sleepPeriod.day], TZ))[0].sleepShape).toBeNull()
    const [row] = await repo.listSleepSessions(USER, sleepPeriod.day, sleepPeriod.day)
    expect(row.onsetAt).toBeUndefined()
    expect(row.finalWakeAt).toBeUndefined()
    expect(row.computedAwakenings).toBeUndefined()
  })

  it('a night from another source carries none', async () => {
    await repo.saveSleepSession(USER, {
      date: '2026-09-01', sleepStart: new Date('2026-08-31T12:00:00Z'), sleepEnd: new Date('2026-08-31T20:00:00Z'), durationHours: 7.5,
    }, 'health_connect')
    const [row] = await repo.listSleepSessions(USER, '2026-09-01', '2026-09-01')
    expect(row.onsetAt).toBeUndefined()
    expect(row.computedAwakenings).toBeUndefined()
  })
})
